var io = require('socket.io-client');
var Handlebars = require("handlebars");
var idb = require("idb");

var IndexedDBService = require("../services/indexedDBService.js");
var UserService = require("../services/userService.js");
var MessageService = require("../services/messageService.js");
var RestService = require("../services/restService.js");
var md5 = require("blueimp-md5");

var User = require("../beans/user.js");
var Message = require("../beans/message.js");

Handlebars.registerPartial('chatMessage', '<li>{{this.user.username}}: {{this.content}}</li>');
Handlebars.registerPartial('userItem', '<li>{{this.username}}</li>');

class IndexController {
    constructor() {
        this._initDBs();
        this.indexView = new IndexView();
        this._initSocket();
        this._initData();
        this._initServiceWorker();
    }

    authenticate(username, password) {
        this.loggedIn = this.userService.authenticate(username, password);
        return this.loggedIn.then(user => {
            this.user = user;
            this.socket.emit("user-login", user);
            this.users.set(user.id, user);
            this.indexView.updateUserList(this.users);
            this.messageService.getAllMessages().then(messages => {
                this.addMessages(...messages);
            });
            return this.user;
        });
    }

    addExistingUser(user) {
        this.userService.addExistingUsers(user).then(() => {
            console.log("User, "+user.username+", successfully added");
        }, function(e) {
            console.log(e);
        });
        this.users.set(user.id, user);
        this.indexView.updateUserList(this.users);
    }

    addUser(username, password) {
        return this.userService.addUsers(new User(username, password));
    }

    removeUser(user) {
        this.users.delete(user.id);
        this.indexView.updateUserList(this.users);
    }

    persistMessages(...messages) {
        return this.messageService.addMessages(...messages).then(_ => {
            this.addMessages(...messages);
        });
    }

    addMessages(...messages) {
        this.messages.push(...messages);
        this.messages.sort((a, b) => a.date - b.date);
        this.indexView.updateMessageList(this.messages);
    }

    publishMessage(content) {
        var message = new Message(this.user, content);
        this.messageService.addMessages(message).then(messages => {
            messages.forEach(message => {
                this.socket.emit("chat", message);
                this.addMessages(message);
            });
        }, e => console.error("Failed to save message: " + e ));
    }


    _initData() {
        this.users = new Map();
        this.messages = [];
    }

    _initSocket() {
        this.socket = io(window.location.origin + "/chat");
        this.socket.on("user-login", this.addExistingUser.bind(this));
        this.socket.on("user-logout", this.removeUser.bind(this)); 
        this.socket.on("chat", this.persistMessages.bind(this));
        this.socket.on("disconnect", () => {
            this.socket.emit("user-logout", this.user);
        });
        setInterval(() => {
            this.socket.emit("pulse", this.socket.id);
        }, 30000);
    }

    _initDBs() {
        if(window.location.search.includes("local")) {
            this.keypath = "id";
            this.dbPromise = idb.open('dc2f', 2, upgradeDB => {
                upgradeDB.createObjectStore(this.userStore, {keyPath: this.keypath});
                upgradeDB.createObjectStore(this.messageStore, {keyPath: this.keypath});
            });

            this.userStore = "user";
            this._userServiceInternal = new IndexedDBService(this.userStore, this.dbPromise, this.keypath);
            this.userService = new UserService(this._userServiceInternal);

            this.messageStore = "message";
            this._messageServiceInternal = new IndexedDBService(this.messageStore, this.dbPromise, this.keypath);
            this.messageService = new MessageService(this._messageServiceInternal);
        }
        else {
            let userRestService = function(baseUrl) {
                this.baseUrl = baseUrl;
            };
            userRestService.prototype = Object.create(RestService.prototype);
            userRestService.prototype.authenticate = function(username, password) {
                return this._constructRequest(this.baseUrl+'/auth/'+username+'/'+md5(password), 'post')
                    .then(users=> users[0]);
            };
            userRestService.prototype.getByUsername = function(username) {
                return this._constructRequest(this.baseUrl+'/by-username/'+username, 'get')
                    .then(users=> users[0]);
            };
            this.userService = new UserService(new userRestService(window.location.origin+'/users'));
            this.messageService = new MessageService(new RestService(window.location.origin+"/messages"));
        }
        window.messageService = this.messageService;
    }

    _initServiceWorker() {
        //TODO: create service worker
    }
}

class IndexView {
    constructor() {
        this.userListSource = document.getElementById("userList").innerHTML;
        this.userListTemplate = Handlebars.compile(this.userListSource);

        this.threadSource = document.getElementById("chatThread").innerHTML;
        this.threadTemplate = Handlebars.compile(this.threadSource);
    }

    updateUserList(users) {
        var html = this.userListTemplate(Array.from(users.values()));
        var div = document.getElementById("users");
        div.innerHTML = html;
    }

    updateMessageList(messages) {
        var html = this.threadTemplate(messages);
        var div = document.getElementById("messages");
        div.innerHTML = html;
    }
}

window.IndexController = IndexController;
