
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

   async registerMessageWatcher(watcher) {
        console.log("FBStorage.registerMessageWatcher", this.db);
        let ref = await this.db.ref(`/chats/${this.space}/messages`);
        this.watcher = watcher;
        ref.on('child_added', (snapshot) => {
            let msg = snapshot.val();
            watcher(msg);
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
            this.chatbots[bot.name] = bot;
        }
        this.botName = "Alan Watts";
        this.chatbot = this.chatbots[this.botName];
        this.chatObj = newChatObj(this.botName);
        this.messages = [];
        this.dump();
    }

    getChatObj() {
        return this.chatObj;
    }

    async setAgent(botName) {
        //this.clearChat();   // maybe later skip this
        this.botName = botName;
        this.chatbot = this.chatbots[botName];
        this.chatObj.botName = botName;
        let lineMsg = clone(this.chatbot.intro[0]);
        lineMsg.botName = botName;
        this.appendLine(lineMsg);
    }

    async appendLine(msg) {
        console.log("ChatTool.appendLine", msg);
        this.messages.push(msg);
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
        this.store = new FBStorage(db,this.space);
        this.store.registerMessageWatcher(msg => {
            console.log("myLineWatcher", msg);
            this.messages.push(msg);
            inst.lineWatcher(msg);
        });
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

    // and return the response
    // use the v1/chat/completions endpoint
    async callOpenAI() {
        let model = "gpt-3.5-turbo";
        // make messages a clone of chatbot prompt
        let messages = clone(this.chatbot.prompt);
        // append messages in chatlog to messages
        let lineMsgs = this.messages;
        for (let i = 0; i < lineMsgs.length; i++) {
            let msg = lineMsgs[i];
            let role = msg.role;
            if (role == "user" && msg.userName) {
                let xrole = firstName(msg.userName);
            }
            msg = { role, content: msg.content }
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

    async handleUserInput(text, userName) {
        // append text to chatlog
        let name = firstName(userName);
        let lineMsg = { 
            role: "user", content: text,
            time: getClockTime(),
            name, userName };
        this.appendLine(lineMsg);
        let botName = this.botName;
        // now ask openai for a response
        let response = null;
        try {
            response = await this.callOpenAI();
        } catch (err) {
            console.log("error", err);
            $("#chatlog").append(`<p><i>sorry, couldn't get through to ${botName}</i></p>\n`);
            return;
        }
        let replyText = response.choices[0].message.content;
        let msg = { role: "assistant", content: replyText,
                    botName, time: getClockTime() }
        this.appendLine(msg)
    }

    dump() {
        console.log("ChatToo.dump");
        console.log("space", this.space);
        console.log("chatbots", this.chatbots);
    }
}

let userName = "guest";

async function setAgent() {
    console.log("setAgent");
    let botName = $("#agent").val();
    console.log("botName", botName);
    $("#header").html("Chat with " + botName);
    chatTool.setAgent(botName);
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
    let fname = getChatDesc(chatTool.botName)+".json";
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
    let fname = getChatDesc(chatTool.botName)+".rtf";
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
    //content = content.replace(/\n/g, "<br>\n");
    $("#chatlog").append(`<p><i>${name}:</i> ${content}</p>\n`);
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
    for (let name in chatTool.chatbots) {
        $("#agent").append(`<option value="${name}">${name}</option>`);
    }
    // set the agent
    $("#agent").val(botName);
}


