let Couchbase = require("couchbase");
let Express = require("express");
let UUID = require("uuid");
let BodyParser = require("body-parser");
let BCrypt = require("bcryptjs");

let app = Express();
let N1qlQuery = Couchbase.N1qlQuery;

app.use(BodyParser.json());
app.use(BodyParser.urlencoded({ extended: true }));

let cluster = new Couchbase.Cluster('couchbase://localhost');
// using env variables - username and password
cluster.authenticate(process.env.USERNAME, process.env.PASSWORD);
let bucket = cluster.openBucket('example');
bucket.on('error', function(err) {
    console.log('Error connecting to Couchbase Server:', err);
});

let validate = function(req, res, next) {
    let authHeader = req.headers["authorization"];
    if(authHeader) {
        bearerToken = authHeader.split(" ");
        if(bearerToken.length == 2) {
            bucket.get(bearerToken[1], (err, result) => {
                if(err) {
                    return res.status(500).send(err);
                }
                req.pid = result.value.pid;
                bucket.touch(bearerToken[1], 3600, (err, result) => {});
                next();
            });
        } else {
            return res.status(401).send({ "message": "Bearer token is malformed" });    
        }
    } else {
        return res.status(401).send({ "message": "An authorization header is required" });
    }
}

app.post("/register", (req, res) => {
    if(!req.body.username) {
        return res.status(401).send({ "message": "A `username` is required" });
    } else if(!req.body.password) {
        return res.status(401).send({ "message": "A `password` is required" });
    }
    let id = UUID.v4();
    let account = {
        "type": "account",
        "pid": id,
        "username": req.body.username,
        "password": BCrypt.hashSync(req.body.password, 10)
    }
    let profile = req.body;
    profile.type = "profile";
    delete profile.username;
    delete profile.password;
    bucket.insert(id, profile, (err, result) => {
        if(err) {
            return res.status(500).send(err);
        }
        bucket.insert(account.username, account, (err, result) => {
            if(err) {
                bucket.remove(id);
                return res.status(500).send(err);
            }
            res.send(result);
        });
    });
});

app.post("/login", (req, res) => {
    if(!req.body.username) {
        return res.status(401).send({ "message": "A `username` is required" });
    } else if(!req.body.password) {
        return res.status(401).send({ "message": "A `password` is required" });
    }
    bucket.get(req.body.username, (err, result) => {
        if(err) {
            return res.status(500).send(err);
        }
        if(!BCrypt.compareSync(req.body.password, result.value.password)) {
            return res.status(500).send({ "message": "The password is invalid" });
        }
        let id = UUID.v4();
        let session = {
            "type": "session",
            "pid": result.value.pid
        }
        bucket.insert(id, session, { "expiry": 3600}, (err, result) => {
            if(err) {
                return res.status(500).send(err);
            }
            res.send({ "sid": id });
        });
    });
});

app.get("/blogs", validate, (req, res) => {
    let query = N1qlQuery.fromString("SELECT `" + bucket._name + "`.* FROM `" + bucket._name + "` WHERE type = 'blog' AND pid = $id");
    bucket.query(query, { "id": req.pid }, (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.send(result);
    });
});

app.post("/blog", validate, (req, res) => {
    if(!req.body.title) {
        return res.status(401).send({ "message": "A `title` is required" });
    } else if(!req.body.content) {
        return res.status(401).send({ "message": "A `content` is required" });
    }
    let blog = {
        "type": "blog",
        "pid": req.pid,
        "title": req.body.title,
        "content": req.body.content,
        "timestamp": (new Date()).getTime()
    }
    bucket.insert(UUID.v4(), blog, (err, result) => {
        if(err) {
            return res.status(500).send(err);
        }
        res.send(blog);
    });
});

let server = app.listen(3000, () => {
    console.log("Listening on port " + server.address().port + "...");
});