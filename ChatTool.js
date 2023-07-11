
// strict mode
"use strict";

// get query string parameters from URL
function getQueryStringParams() {
    let params = {};
    let query = window.location.search.substring(1);
    let vars = query.split("&");
    for (let i = 0; i < vars.length; i++) {
        let pair = vars[i].split("=");
        params[pair[0]] = decodeURIComponent(pair[1]);
    }
    return params;
}

// get query string parameter by name
function getQueryStringParam(name) {
    let params = getQueryStringParams();
    return params[name];
}

// get the space name to use for this chat
function getSpaceName() {
    let spaceName = getQueryStringParam("space");
    if (spaceName == null) {
        spaceName = "Garden2";
    }
    return spaceName;
}

// return time in seconds
function getClockTime() {
    return Date.now() / 1000.0;
}

function timeToMDY_HMS(time) {
    let date = new Date(time * 1000);
    let mdy = date.toLocaleDateString();
    let hms = date.toLocaleTimeString();
    return `${mdy} ${hms}`;
}

// return the first name of a name with one or more words separated by spaces
function firstName(name) {
    let names = name.split(" ");
    return names[0];
}

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// This is the base class for our persistent storage.
// Two versions we will implement are LocalStorage and FirebaseStorage.
//
class Storage {

    async registerMessageWatcher(watcher) {
        console.log("registerMessageWatcher not implemented");
    }

    async save(obj) {
        console.log("save not implemented");
    }

    async load() {
        console.log("load not implemented");
        return null;
    }

    async appendMessage(msg) {
        console.log("appendMessage not implemented");
    }
}

class FBStorage extends Storage {
    constructor(db, space) {
        super();
        this.db = db;
        this.space = space;
        this.chatRef = db.ref(`/chats/${this.space}`);
    }

    async registerMessageWatcher(msgWatcher) {
        console.log("FBStorage.registerMessageWatcher", this.db);
        let ref = await this.db.ref(`/chats/${this.space}/messages`);
        this.msgWatcher = msgWatcher;
        ref.on('child_added', (snapshot) => {
            let msg = snapshot.val();
            msg.key = snapshot.key;
            msgWatcher.handleNewMessage(msg);
        });
        ref.on('child_changed', (snapshot) => {
            console.log("child_changed", snapshot);
            msgWatcher.handleChangedMessage(snapshot);
        });
        ref.on('child_removed', (snapshot) => {
            console.log("child_removed", snapshot);
            msgWatcher.handleDeletedMessage(snapshot);
        });
    }

    async load() {
        console.log("FBStorage load");
        let obj = await this.chatRef.get();
        obj = obj.val();
        console.log(" >>", obj);
        return obj;
    }

    async save(obj) {
        console.log("FBStorage save", obj);
        await this.chatRef.set(obj);
    }

    async remove(key) {
        console.log("FBStorage remove", key);
        await this.db.ref(`/chats/${this.space}/messages/${key}`).remove();
    }

    async appendMessage(msg) {
        console.log("FBStorage appendMessage", msg);
        await this.db.ref(`/chats/${this.space}/messages`).push(msg);
    }
}

// return a descriptor string for this chat
function getChatDesc(botName) {
    let startTime = getClockTime();
    let mdy_hms = timeToMDY_HMS(startTime);
    return `${botName} ${mdy_hms}`;
}

function newChatObj(botName) {
    return {
        botName: botName,
        startTime: getClockTime(),
        chatName: getChatDesc(botName),
        messages: []
    }
}

class ChatTool {
    constructor(lineWatcher, space) {
        if (space == null) {
            space = getSpaceName();
        }
        this.space = space;
        this.lineWatcher = lineWatcher;
        this.chatbots = {};
        for (let i = 0; i < chatbotsList.length; i++) {
            let bot = chatbotsList[i];
            if (bot.hidden) {
                continue;
            }
            this.chatbots[bot.name] = bot;
        }
        this.botName = "Alan Watts";
        this.chatbot = this.chatbots[this.botName];
        this.chatObj = newChatObj(this.botName);
        this.messages = [];
        this.dump();
        this.showNamesToAPI = true;
        this.autoReply = true;
    }

    setAutoReply(autoReply) {
        console.log("ChatTool.setAutoReply", autoReply);
        this.autoReply = autoReply;
    }

    getChatObj() {
        return this.chatObj;
    }

    async setAgent(botName, showPrompt = true) {
        //this.clearChat();   // maybe later skip this
        this.botName = botName;
        this.chatbot = this.chatbots[botName];
        this.chatObj.botName = botName;
        if (showPrompt) {
            let lineMsg = clone(this.chatbot.intro[0]);
            lineMsg.botName = botName;
            this.appendLine(lineMsg);
        }
    }

    async undo() {
        console.log("ChatTool.undo");
        // get the last message
        let n = this.messages.length;
        if (n == 0) {
            return;
        }
        let lastMsg = this.messages[n - 1];
        await this.store.remove(lastMsg.key);
    }

    async appendLine(msg) {
        console.log("ChatTool.appendLine", msg);
        //this.messages.push(msg);
        await this.store.appendMessage(msg);
    }

    async clearChat() {
        this.messages = [];
        this.chatObj = newChatObj(this.botName);
        await this.store.save(this.chatObj);
    }

    async initFirebaseDB(user, db) {
        console.log("ChatTool.initFirebaseDB", user, db);
        let inst = this;
        this.user = user;
        this.db = db;
        this.store = new FBStorage(db, this.space);
        this.store.registerMessageWatcher(this);
        console.log("initFirebaseDB getting chatObj from store");
        let chatObj = await this.store.load();
        if (chatObj == null) {
            console.log("Creating new chat");
            this.clearChat();
            chatObj = await this.store.load();
        }
        this.chatObj = chatObj;
        this.botName = chatObj.botName;
        this.chatbot = this.chatbots[this.botName];
        console.log("chatObj", chatObj);
    }

    handleNewMessage(msg) {
        console.log("myLineWatcher", msg);
        this.messages.push(msg);
        this.lineWatcher(msg);
    }

    handleChangedMessage(snap) {
        console.log("handleChangedMessage", snap);
    }

    handleDeletedMessage(snap) {
        console.log("handleDeletedMessage", snap);
        let key = snap.key;
        console.log("key", key);
        // remove msg from messages with key
        for (let i = 0; i < this.messages.length; i++) {
            let msg = this.messages[i];
            console.log("i, key", i, msg.key);
            if (msg.key == key) {
                console.log("*** bingo");
                this.messages.splice(i, 1);
                lineRemover(msg);
                return;
            }
        }
        console.log("key not found", key);
    }

    // and return the response
    // use the v1/chat/completions endpoint
    async callOpenAI(model) {
        console.log("ChatTool.callOpenAI", model);
        // make messages a clone of chatbot prompt
        let messages = clone(this.chatbot.prompt);
        // append messages in chatlog to messages
        let lineMsgs = this.messages;
        for (let i = 0; i < lineMsgs.length; i++) {
            let msg = lineMsgs[i];
            let text = msg.content;
            let role = msg.role;
            if (role == "user" && msg.userName && this.showNamesToAPI) {
                let name = firstName(msg.userName);
                text = `${name}: ${text}`;
            }
            msg = { role, content: text }
            messages.push(msg);
        }
        console.log("messages sent to openai:", JSON.stringify(messages, null, 2));
        let rep = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages
            })
        });
        console.log("reply", rep);
        // get json returned by the server
        const response = await rep.json();
        console.log("response", response);
        return response;
    }

    async callCurrentAgent() {
        let model = "gpt-3.5-turbo";
        //model = "gpt-4";
        //model = 'gpt-4-0613';

        let botName = this.botName;
        console.log("callCurrentAgent", botName);
        // now ask openai for a response
        let response = null;
        try {
            response = await this.callOpenAI(model);
        } catch (err) {
            console.log("error", err);
            $("#chatlog").append(`<p><i>sorry, couldn't get through to ${botName}</i></p>\n`);
            return;
        }
        let replyText = response.choices[0].message.content;
        let msg = {
            role: "assistant", content: replyText,
            model, botName, time: getClockTime()
        }
        this.appendLine(msg)
    }

    async handleUserInput(text, userName) {
        // append text to chatlog
        let name = firstName(userName);
        // if text starts with a name (not containing whitespace) and :,
        // then extract the name and remove it from start of text
        let m = text.match(/^(\S+):/);
        if (m) {
            name = m[1];
            userName = name;
            text = text.substring(name.length + 1);
        }
        let lineMsg = {
            role: "user", content: text,
            time: getClockTime(),
            name, userName
        };
        this.appendLine(lineMsg);
        if (this.autoReply) {
            await this.callCurrentAgent();
        }
    }

    dump() {
        console.log("ChatToo.dump");
        console.log("space", this.space);
        console.log("chatbots", this.chatbots);
    }
}

let userName = "guest";

// this is called when the user selects an agent (chatbot)
async function setAgent() {
    console.log("setAgent");
    let botName = $("#agent").val();
    console.log("botName", botName);
    $("#header").html("Chat with " + botName);
    chatTool.setAgent(botName);
}

async function callAgent(name) {
    console.log("callAgent", name);
    $("#agent").val(name);
    chatTool.setAgent(name, false);
    chatTool.callCurrentAgent();
}

// download the chatlog as a JSON file
async function downloadChatLogJSON() {
    console.log("downloadChatLogJSON");
    let chatObj = clone(chatTool.getChatObj());
    // We want to just use a list instead of the keys
    // that are in firestore.  Not sure what is best to
    // do for this.
    chatObj.messages = chatTool.messages;
    console.log("chatObj", chatObj);
    let chatObjString = JSON.stringify(chatObj);
    let blob = new Blob([chatObjString], {
        type: "text/plain;charset=utf-8"
    });
    let fname = getChatDesc(chatTool.botName) + ".json";
    saveAs(blob, fname);
}

// download the chatlog as a JSON file
async function downloadChatLogRTF() {
    console.log("downloadChatLog");
    const htmlStr = document.getElementById("chatdoc").innerHTML;
    var htmlToRtfLocal = new window.htmlToRtf();
    var rtfContent = htmlToRtfLocal.convertHtmlToRtf(htmlStr);
    let blob = new Blob([rtfContent], {
        type: "application/rtf;charset=utf-8"
    });
    let fname = getChatDesc(chatTool.botName) + ".rtf";
    saveAs(blob, fname);
}

// now write the saveAs function that will actually do the download
function saveAs(blob, filename) {
    console.log("saveAs");
    if (window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveBlob(blob, filename);
    } else {
        let a = document.createElement("a");
        document.body.appendChild(a);
        a.style = "display: none";
        let url = window.URL.createObjectURL(blob);
        a.href = url;
        a.download = filename;
        a.click();
        window.URL.revokeObjectURL(url);
    }
}


// when the user presses the clear button, clear the chatlog div
async function clearChat() {
    console.log("clearChat");
    // clear the chatlog div
    $("#chatlog").html("");
    // clear the chatObj
    chatTool.clearChat();
}

async function handleUndo() {
    console.log("handleUndo");
    chatTool.undo();
}

// get input text user has typed, send it to openai
// display response and save response in local storage.
async function handleUserInput() {
    console.log("handleUserInput");
    // get the text from the chatinput
    let text = $("#chatinput").val();
    console.log("text", text);
    $("#chatinput").val("");
    text = text.trim();
    if (text == "") {
        return;
    }
    await chatTool.handleUserInput(text, userName);
}

// convert a firebase key to an id.  The keys
// seem to start with - which is not allowed, the
// remaining characters are ok.
function keyToId(key) {
    return key.substring(1);
}

// this gets called each time there is a new line message
// and displays it on the log.
function lineHandler(msg) {
    console.log("lineHandler", msg);
    let name = null;
    if (msg.role == "assistant") {
        if (msg.botName) {
            name = msg.botName;
        } else {
            name = chatTool.botName;
        }
    } else {
        if (msg.userName) {
            name = msg.userName;
        } else {
            name = userName;
        }
        name = firstName(name);
    }
    let content = msg.content;
    let key = msg.key;
    let id = keyToId(key);
    console.log("id", id);
    //content = content.replace(/\n/g, "<br>\n");
    let jqElem = $("#chatlog").append(`<p id="${id}"><i>${name}:</i> ${content}</p>\n`);
    jqElem = $("#" + id);
    jqElem.click(() => {
    //$("#" + id).click(() => {
        console.log("click", key, id);
        jqElem.css("background-color", "yellow");
    });
}


function lineRemover(msg) {
    console.log("lineRemover", msg, msg.key);
    let key = msg.key;
    let id = keyToId(key);
    console.log("id", id);
    $("#" + id).remove();
}

async function setAutoReply() {
    console.log("setAutoReply");
    // see if autoReply is checked
    let autoReply = $("#autoReply").prop("checked");
    console.log("autoReply", autoReply);
    if (autoReply) {
        console.log("hiding agentButtons")
        $("#chatbotButtons").hide(500);
    }
    else {
        console.log("showing agentButtons")
        $("#chatbotButtons").show(500);
    }

    chatTool.setAutoReply(autoReply);
}

async function initChatStuff() {
    console.log("starting chatbot version 0.000103");
    let botName = chatTool.botName;
    $("#agent").val(botName);
    $("#header").html(`Chat with ${botName}`);
    // when the user presses enter in the chatinput
    $("#chatinput").keypress(function (e) {
        // if the key pressed is enter
        if (e.which == 13) {
            handleUserInput();
        }
    });
    // when the user chooses a new agent
    $("#agent").change(function () {
        setAgent();
    });
    // fill in options for agent select
    $("#agent").html("");
    for (let name in chatTool.chatbots) {
        $("#agent").append(`<option value="${name}">${name}</option>`);
    }
    // set the agent
    $("#agent").val(botName);
    //
    // create a button for each chatbot
    $("#chatbotButtons").html("");
    for (let name in chatTool.chatbots) {
        let chatbot = chatTool.chatbots[name];
        $("#chatbotButtons").append(
            `<button class="chatbotButton" onclick="callAgent('${name}')">${name}</button>`);
    }
}


