
// strict mode
"use strict";

// return the first name of a name with one or more words separated by spaces
function firstName(name) {
    let names = name.split(" ");
    return names[0];
}


function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

class Storage {
    async save(obj) {
        console.log("save not implemented");
    }

    async load() {
        console.log("load not implemented");
        return null;
    }
}

class LocalStorage extends Storage {
    async save(obj) {
        console.log("LocalStorage.save", obj);
        localStorage.setItem("chatbot", JSON.stringify(obj));
    }

    async load() {
        console.log("LocalStorage.load");
        let obj = JSON.parse(localStorage.getItem("chatbot"));
        console.log(" >>", obj);
        return obj;
    }
}

class FBStorage extends Storage {
    constructor(db) {
        super();
        this.db = db;
        this.chatRef = db.ref('/chatlog');
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
}

class ChatTool {
    constructor(lineWatcher, space = "Garden") {
        this.space = space;
        this.lineWatcher = lineWatcher;
        this.chatbots = {};
        for (let i = 0; i < chatbotsList.length; i++) {
            let bot = chatbotsList[i];
            this.chatbots[bot.name] = bot;
        }
        this.botName = "Alan Watts";
        this.chatbot = this.chatbots[this.botName];
        this.chatObj = { botName: this.botName, chatlog: [] };
        this.dump();
    }

    async getChatObj() {
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
        this.chatObj.chatlog.push(msg);
        this.lineWatcher(msg);
        //await saveChatObj(chatObj);
        await this.store.save(this.chatObj);
    }

    async clearChat() {
        this.chatObj.chatlog = [];
        this.chatObj.botName = this.botName;
        await this.store.save(this.chatObj);
    }

    async initFirebaseDB(user, db) {
        console.log("ChatTool.initFirebaseDB");
        this.user = user;
        this.db = db;
        this.store = new FBStorage(db);
        console.log("initFirebaseDB getting chatObj from store");
        let chatObj = await this.store.load();
        this.chatObj = chatObj;
        this.botName = chatObj.botName;
        this.chatbot = this.chatbots[this.botName];
        console.log("chatObj", chatObj);
        if (chatObj.chatlog == null) {
            chatObj.chatlog = [];
        }
        console.log("chatObj", chatObj);
        let lineMsgs = chatObj.chatlog;
        if (!lineMsgs) {
            lineMsgs = [];
        }
        for (let i = 0; i < lineMsgs.length; i++) {
            let line = lineMsgs[i];
            this.lineWatcher(line);
        }
        return chatObj;
    }

    // and return the response
    // use the v1/chat/completions endpoint
    async callOpenAI() {
        let model = "gpt-3.5-turbo";
        // make messages a clone of chatbot prompt
        let messages = clone(this.chatbot.prompt);

        // append messages in chatlog to messages
        let lineMsgs = this.chatObj.chatlog;
        for (let i = 0; i < lineMsgs.length; i++) {
            let msg = lineMsgs[i];
            let role = msg.role;
            if (role == "user" && msg.userName) {
                let xrole = firstName(msg.userName);
            }
            msg = { role, content: msg.content }
            messages.push(msg);
        }
        console.log("messages:", JSON.stringify(messages, null, 2));
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
        let lineMsg = { role: "user", content: text, name, userName };
        chatTool.appendLine(lineMsg);
        let botName = chatTool.botName;
        // now ask openai for a response
        let response = null;
        try {
            response = await chatTool.callOpenAI();
        } catch (err) {
            console.log("error", err);
            $("#chatlog").append(`<p><i>sorry, couldn't get through to ${botName}</i></p>\n`);
            return;
        }
        let replyText = response.choices[0].message.content;
        let msg = { role: "assistant", content: replyText, botName }
        chatTool.appendLine(msg)
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
async function downloadChatLog() {
    console.log("downloadChatLog");
    let chatObj = await chatTool.getChatObj();
    let chatlog = chatObj.chatlog;
    let chatlogString = JSON.stringify(chatlog);
    let blob = new Blob([chatlogString], {
        type: "text/plain;charset=utf-8"
    });
    saveAs(blob, "chatlog.json");
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
    content = content.replace(/\n/g, "<br>\n");
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


