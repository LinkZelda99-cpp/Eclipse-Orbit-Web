const $ = id => document.getElementById(id);
const OLLAMA_DEFAULT = "http://127.0.0.1:11434";
const STORAGE_KEY = "eclipse-orbit-web-v1";
const PAGE_SOURCE = "eclipse-orbit-web";
const EXTENSION_SOURCE = "eclipse-orbit-companion";
let mode = localStorage.getItem("orbit-web-mode") || "ollama";
let endpoint = localStorage.getItem("orbit-web-endpoint") || OLLAMA_DEFAULT;
let model = localStorage.getItem("orbit-web-model") || "";
let models = [];
let messages = [];
let chats = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
let activeChatId = "";
let orbitState = null;
let orbitConnected = false;
let bridgeAvailable = false;
let bridgeWaiters = [];
let busy = false;
let controller = null;
let selectedMemoryId = "";
const pending = new Map();

function id() { return crypto.randomUUID(); }
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}
function status(online, label, detail) {
  $("status-dot").classList.toggle("online", online);
  $("connection-label").textContent = label;
  $("connection-detail").textContent = detail;
}
function saveChats() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats.slice(0, 60)));
}
function saveCurrentChat() {
  if (!messages.length) return;
  const title = messages.find(item => item.role === "user")?.content?.slice(0, 52) || "New conversation";
  const existing = chats.find(item => item.id === activeChatId);
  if (existing) { existing.messages = messages; existing.title = title; existing.updated = Date.now(); }
  else { activeChatId = id(); chats.unshift({id:activeChatId,title,messages,updated:Date.now()}); }
  saveChats(); renderHistory(); $("chat-title").textContent = title;
}
function renderHistory() {
  const host = $("chat-history"); host.replaceChildren();
  const source = mode === "companion" ? (orbitState?.chats || []) : chats;
  for (const chat of source.slice(0, 40)) {
    const button = document.createElement("button");
    button.className = "history-chat" + (chat.id === activeChatId ? " active" : "");
    button.textContent = chat.title || "Untitled conversation";
    button.title = button.textContent;
    button.addEventListener("click", () => mode === "companion" ? openOrbitChat(chat.id) : openLocalChat(chat.id));
    host.append(button);
  }
}
function renderInline(parent, source) {
  const text = String(source || "");
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0], el = document.createElement(token.startsWith("`") ? "code" : token.startsWith("**") ? "strong" : "em");
    el.textContent = token.slice(token.startsWith("**") ? 2 : 1, token.startsWith("**") ? -2 : -1);
    parent.append(el); cursor = match.index + token.length;
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}
function renderMarkdown(parent, source) {
  parent.replaceChildren();
  const lines = String(source || "").split(/\r?\n/);
  let paragraph = [], list = null, code = null;
  const flush = () => { if (paragraph.length) { const p=document.createElement("p"); renderInline(p,paragraph.join("\n")); parent.append(p); paragraph=[]; } list=null; };
  for (const line of lines) {
    if (code) {
      if (line.startsWith("```")) { const pre=document.createElement("pre"), c=document.createElement("code"); c.textContent=code.join("\n"); pre.append(c); parent.append(pre); code=null; }
      else code.push(line);
      continue;
    }
    if (line.startsWith("```")) { flush(); code=[]; continue; }
    if (!line.trim()) { flush(); continue; }
    const heading=/^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) { flush(); const h=document.createElement("h"+heading[1].length); renderInline(h,heading[2]); parent.append(h); continue; }
    const bullet=/^\s*[-*+]\s+(.+)$/.exec(line);
    if (bullet) { if (!list) { flush(); list=document.createElement("ul"); parent.append(list); } const li=document.createElement("li"); renderInline(li,bullet[1]); list.append(li); continue; }
    paragraph.push(line);
  }
  if (code) { const pre=document.createElement("pre"),c=document.createElement("code");c.textContent=code.join("\n");pre.append(c);parent.append(pre); }
  flush();
}
function addMessage(role, content) {
  $("welcome").hidden = true;
  const card=document.createElement("article"); card.className="message "+role;
  const avatar=document.createElement("div"); avatar.className="message-avatar"; avatar.textContent=role==="user"?"Y":"◈";
  const column=document.createElement("div"); column.style.flex="1"; column.style.minWidth="0";
  const head=document.createElement("div"); head.className="message-head"; head.textContent=role==="user"?"YOU":"ECLIPSE ORBIT";
  const body=document.createElement("div"); body.className="message-body"; renderMarkdown(body,content);
  column.append(head,body); card.append(avatar,column); $("messages").append(card);
  $("chat-area").scrollTop=$("chat-area").scrollHeight;
  return {body,card};
}
function renderMessages() {
  $("messages").replaceChildren();
  $("welcome").hidden = messages.length > 0;
  for (const message of messages) addMessage(message.role,message.content);
}
function openLocalChat(chatId) {
  const chat=chats.find(item=>item.id===chatId); if(!chat)return;
  activeChatId=chat.id; messages=chat.messages.map(item=>({...item}));
  $("chat-title").textContent=chat.title; renderMessages(); renderHistory();
}
function newChat() {
  if (busy) return;
  activeChatId=""; messages=[]; $("chat-title").textContent="New conversation";
  renderMessages(); renderHistory(); $("prompt").focus();
  if (mode==="companion" && orbitConnected) requestOrbit("new_chat").then(loadOrbitState).catch(error=>toast(error.message));
}
function postToCompanion(message) {
  window.postMessage({source:PAGE_SOURCE,type:"request",message},location.origin);
}
function waitForCompanionBridge(timeout=2500) {
  if(bridgeAvailable)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("The Companion extension was not detected on this page.")),timeout);
    bridgeWaiters.push(()=>{clearTimeout(timer);resolve();});
  });
}
function requestOrbit(type,payload={},onEvent=null) {
  if (!bridgeAvailable) return Promise.reject(new Error("Eclipse Orbit Companion is not connected."));
  const requestId=id();
  return new Promise((resolve,reject)=>{
    pending.set(requestId,{resolve,reject,onEvent});
    postToCompanion({type,requestId,...payload});
  });
}
window.addEventListener("message",event=>{
  if(event.source!==window || event.origin!==location.origin || event.data?.source!==EXTENSION_SOURCE)return;
  const data=event.data;
  if(data.type==="bridge-status"){
    bridgeAvailable=Boolean(data.connected);
    orbitConnected=bridgeAvailable;
    if(bridgeAvailable){for(const resolve of bridgeWaiters.splice(0))resolve();}
    if(!orbitConnected){
      const error=new Error(data.error||"The Companion extension disconnected.");
      for(const [,entry] of pending)entry.reject(error);
      pending.clear();
      if(busy)finishGeneration();
      status(false,"Companion unavailable",error.message);
    } else status(true,"Orbit Companion ready","Shared desktop connection available.");
    $("memory-sync").classList.toggle("online",orbitConnected);
    return;
  }
  if(data.type!=="native-event")return;
  const eventData=data.event||{};
  const entry=pending.get(eventData.requestId);
  if(entry?.onEvent) entry.onEvent(eventData);
  if(eventData.type==="error" && eventData.done){
    orbitConnected=false;
    status(false,"Orbit desktop unavailable",eventData.error||"Start Eclipse Orbit and retry.");
    if(entry){entry.reject(new Error(eventData.error||"Orbit request failed."));pending.delete(eventData.requestId);}
    if(eventData.requestId===activeRequestId){finishGeneration();}
    return;
  }
  if(eventData.done && entry){
    if(eventData.ok===false)entry.reject(new Error(eventData.error||"Orbit rejected the request."));
    else entry.resolve(eventData);
    pending.delete(eventData.requestId);
  }
  if(eventData.type==="started" && eventData.conversationId) activeChatId=eventData.conversationId;
  if(eventData.done && eventData.messages && eventData.requestId===activeRequestId){
    messages=eventData.messages.map(item=>({role:item.role,content:item.content||""}));
    renderMessages(); saveCurrentChat();
  }
});
let activeRequestId="";
function finishGeneration() {
  busy=false; activeRequestId=""; controller=null;
  $("send-button").disabled=false; $("prompt").disabled=false; $("stop-button").hidden=true;
}
async function discoverOllama() {
  endpoint=$("ollama-endpoint").value.trim().replace(/\/$/,"")||OLLAMA_DEFAULT;
  localStorage.setItem("orbit-web-endpoint",endpoint);
  const response=await fetch(endpoint+"/api/tags");
  if(!response.ok)throw new Error("Ollama returned HTTP "+response.status);
  const data=await response.json();
  models=(data.models||[]).map(item=>item.name).filter(Boolean);
  const select=$("model-select");select.replaceChildren();
  for(const name of models){const option=document.createElement("option");option.value=name;option.textContent=name;select.append(option);}
  if(!models.length)throw new Error("Ollama is running, but no models are installed yet.");
  model=models.includes(model)?model:models[0];select.value=model;
  localStorage.setItem("orbit-web-model",model);
  status(true,"Local Ollama connected",endpoint);
  $("mode-pill").textContent="STANDALONE";
  $("privacy-label").textContent="Runs on your device";
  $("disclaimer").textContent="Prompts go directly to your local Ollama server. Eclipse Orbit's desktop app is not required.";
  renderHistory();
  return models;
}
async function loadOrbitState() {
  const state=await requestOrbit("get_state");
  orbitState=state; orbitConnected=true;
  const select=$("model-select");select.replaceChildren();
  for(const item of state.models||[]){const option=document.createElement("option");option.value=JSON.stringify([item.provider,item.model]);option.textContent=item.model+" · "+item.provider;select.append(option);}
  const selected=(state.models||[]).find(item=>item.provider===state.provider&&item.model===state.model)||(state.models||[])[0];
  if(selected){model=JSON.stringify([selected.provider,selected.model]);select.value=model;}
  activeChatId=state.activeConversationId||"";
  $("mode-pill").textContent="ORBIT CONNECTED";
  $("privacy-label").textContent="Shared with desktop Orbit";
  $("disclaimer").textContent="Connected directly to your Eclipse Orbit desktop app through the Companion extension.";
  status(true,"Eclipse Orbit connected","Chats, models, and persistent memory are shared.");
  $("memory-sync").classList.add("online");
  renderHistory();
  if(activeChatId){const chat=await requestOrbit("get_chat",{conversationId:activeChatId});messages=(chat.messages||[]).map(item=>({role:item.role,content:item.content||""}));$("chat-title").textContent=chat.title||"Conversation";renderMessages();}
  return state;
}
async function openOrbitChat(chatId) {
  try {const chat=await requestOrbit("open_chat",{conversationId:chatId});activeChatId=chat.conversationId||chatId;messages=(chat.messages||[]).map(item=>({role:item.role,content:item.content||""}));$("chat-title").textContent=chat.title||"Conversation";renderMessages();renderHistory();}
  catch(error){toast(error.message);}
}
async function sendOllama(text) {
  const history=messages.map(item=>({role:item.role,content:item.content}));
  history.push({role:"user",content:text});
  messages.push({role:"user",content:text});
  addMessage("user",text);
  const assistant=addMessage("assistant","");
  const answer={role:"assistant",content:""};messages.push(answer);
  busy=true;controller=new AbortController();$("send-button").disabled=true;$("prompt").disabled=true;$("stop-button").hidden=false;
  try {
    const response=await fetch(endpoint+"/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model,messages:history,stream:true}),signal:controller.signal});
    if(!response.ok)throw new Error("Ollama returned HTTP "+response.status);
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
    while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
      const lines=buffer.split("\n");buffer=lines.pop();
      for(const line of lines){if(!line.trim())continue;const chunk=JSON.parse(line);answer.content+=chunk.message?.content||"";renderMarkdown(assistant.body,answer.content);$("chat-area").scrollTop=$("chat-area").scrollHeight;if(chunk.done)break;}
    }
    if(buffer.trim()){const chunk=JSON.parse(buffer);answer.content+=chunk.message?.content||"";renderMarkdown(assistant.body,answer.content);}
    saveCurrentChat();
  } catch(error){if(error.name!=="AbortError"){answer.content="**Connection error:** "+error.message;renderMarkdown(assistant.body,answer.content);toast(error.message);}}
  finally{finishGeneration();}
}
async function sendOrbit(text) {
  const selected=$("model-select").value;
  if(!selected)throw new Error("No model is available in Eclipse Orbit.");
  const [provider,selectedModel]=JSON.parse(selected);
  await requestOrbit("select_model",{provider,model:selectedModel});
  messages.push({role:"user",content:text});addMessage("user",text);
  const assistant=addMessage("assistant","");
  busy=true;$("send-button").disabled=true;$("prompt").disabled=true;$("stop-button").hidden=false;
  const requestId=id();activeRequestId=requestId;
  pending.set(requestId,{resolve:()=>{},reject:error=>{toast(error.message);},onEvent:eventData=>{
    if(eventData.type==="token"){const last=messages[messages.length-1];if(last?.role==="assistant")last.content+=eventData.text||"";else messages.push({role:"assistant",content:eventData.text||""});renderMarkdown(assistant.body,messages[messages.length-1].content);}
    if(eventData.type==="error" && !eventData.done){toast(eventData.error||"The model request failed.");}
    if(eventData.type==="done" && eventData.conversationId){
      activeChatId=eventData.conversationId;
      requestOrbit("get_chat",{conversationId:activeChatId}).then(chat=>{
        messages=(chat.messages||[]).map(item=>({role:item.role,content:item.content||""}));
        $("chat-title").textContent=chat.title||"Conversation";
        renderMessages();renderHistory();
      }).catch(error=>toast(error.message));
    }
    if(eventData.done)finishGeneration();
  }});
  postToCompanion({type:"send_message",requestId,conversationId:activeChatId,provider,model:selectedModel,text});
}
async function sendMessage() {
  if(busy)return;
  const text=$("prompt").value.trim();if(!text)return;
  $("prompt").value="";$("prompt").style.height="auto";
  try {
    if(mode==="ollama")await sendOllama(text);
    else await sendOrbit(text);
  } catch(error){toast(error.message);finishGeneration();}
}
async function stopGeneration() {
  if(!busy)return;
  if(mode==="ollama")controller?.abort();
  else if(activeRequestId){try{await requestOrbit("cancel_generation");}catch(error){toast(error.message);}finishGeneration();}
}
async function connectCompanion() {
  mode="companion";localStorage.setItem("orbit-web-mode",mode);
  $("companion-test-status").textContent="Waiting for the Companion extension…";
  try {await waitForCompanionBridge();await loadOrbitState();$("companion-test-status").textContent="Connected";toast("Connected to Eclipse Orbit.");}
  catch(error){$("companion-test-status").textContent=error.message;status(false,"Orbit not available","Install the Companion extension and start Eclipse Orbit desktop.");throw error;}
}
async function testOllama() {
  $("ollama-test-status").textContent="Checking…";
  try {await discoverOllama();$("ollama-test-status").textContent="Connected";toast("Local Ollama connection verified.");}
  catch(error){$("ollama-test-status").textContent=error.message;status(false,"Local AI unavailable",error.message);throw error;}
}
function openSettings() {
  document.querySelector('input[name="connection-mode"][value="'+mode+'"]').checked=true;
  $("ollama-endpoint").value=endpoint;
  $("ollama-settings").hidden=mode!=="ollama";$("companion-settings").hidden=mode!=="companion";
  $("settings-dialog").showModal();
}
async function saveSettings() {
  const chosen=document.querySelector('input[name="connection-mode"]:checked').value;
  mode=chosen;endpoint=$("ollama-endpoint").value.trim().replace(/\/$/,"")||OLLAMA_DEFAULT;
  localStorage.setItem("orbit-web-mode",mode);localStorage.setItem("orbit-web-endpoint",endpoint);
  $("settings-dialog").close();
  try {if(mode==="ollama")await discoverOllama();else await connectCompanion();}
  catch(error){toast(error.message);}
}
async function openMemory() {
  if(mode!=="companion"||!orbitConnected){toast("Connect to Eclipse Orbit Companion to access shared memory.");return;}
  try {
    const result=await requestOrbit("memory_list");const list=$("memory-list");list.replaceChildren();
    for(const item of result.memories||[]){const button=document.createElement("button");button.className="memory-item";const title=document.createElement("strong");title.textContent=(item.pinned?"◆ ":"")+(item.title||"Untitled");const category=document.createElement("small");category.textContent=item.category||"general";button.append(title,category);button.addEventListener("click",()=>{selectedMemoryId=item.id;$("memory-title").value=item.title||"";$("memory-category").value=item.category||"";$("memory-content").value=item.content||"";$("memory-delete").disabled=false;});list.append(button);}
    $("memory-delete").disabled=!selectedMemoryId;$("memory-dialog").showModal();
  } catch(error){toast(error.message);}
}
async function saveMemory() {
  try {
    const result=await requestOrbit("memory_save",{memory:{id:selectedMemoryId,title:$("memory-title").value,category:$("memory-category").value,content:$("memory-content").value,importance:3,pinned:false,source:"user"}});
    if(!result.ok)throw new Error(result.error||"Could not save memory.");
    selectedMemoryId=result.memory.id;toast("Shared memory saved.");$("memory-dialog").close();openMemory();
  } catch(error){toast(error.message);}
}
async function deleteMemory() {
  if(!selectedMemoryId)return;
  try {await requestOrbit("memory_delete",{id:selectedMemoryId});selectedMemoryId="";$("memory-title").value="";$("memory-category").value="";$("memory-content").value="";toast("Memory deleted.");$("memory-dialog").close();openMemory();}
  catch(error){toast(error.message);}
}
function init() {
  $("new-chat").addEventListener("click",newChat);
  $("send-button").addEventListener("click",sendMessage);
  $("stop-button").addEventListener("click",stopGeneration);
  $("prompt").addEventListener("keydown",event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();sendMessage();}});
  $("prompt").addEventListener("input",()=>{$("prompt").style.height="auto";$("prompt").style.height=Math.min($("prompt").scrollHeight,180)+"px";});
  $("open-settings").addEventListener("click",openSettings);$("settings-button").addEventListener("click",openSettings);
  $("welcome-connect").addEventListener("click",()=>{mode="ollama";openSettings();});
  $("welcome-companion").addEventListener("click",()=>{mode="companion";openSettings();});
  $("close-settings").addEventListener("click",()=>$("settings-dialog").close());$("cancel-settings").addEventListener("click",()=>$("settings-dialog").close());
  $("save-settings").addEventListener("click",saveSettings);
  $("test-ollama").addEventListener("click",()=>testOllama().catch(()=>{}));
  $("test-companion").addEventListener("click",()=>connectCompanion().catch(()=>{}));
  $("model-select").addEventListener("change",async()=>{if(mode==="ollama"){model=$("model-select").value;localStorage.setItem("orbit-web-model",model);}else if(orbitConnected){const [provider,selectedModel]=JSON.parse($("model-select").value);try{await requestOrbit("select_model",{provider,model:selectedModel});}catch(error){toast(error.message);}}});
  $("memory-button").addEventListener("click",openMemory);$("close-memory").addEventListener("click",()=>$("memory-dialog").close());
  $("memory-new").addEventListener("click",()=>{selectedMemoryId="";$("memory-title").value="";$("memory-category").value="general";$("memory-content").value="";$("memory-delete").disabled=true;});
  $("memory-save").addEventListener("click",saveMemory);$("memory-delete").addEventListener("click",deleteMemory);
  $("clear-chats").addEventListener("click",()=>{if(confirm("Clear locally saved web conversations?")){chats=[];activeChatId="";saveChats();renderHistory();}});
  $("mobile-menu").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
  window.addEventListener("message",event=>{if(event.source===window&&event.data?.source===EXTENSION_SOURCE&&event.data.type==="bridge-status"&&event.data.connected){loadOrbitState().catch(()=>{});}});
  renderHistory();
  if(mode==="ollama"){openSettings();testOllama().catch(()=>{});}
  else {openSettings();connectCompanion().catch(()=>{});}
}
init();