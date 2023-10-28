const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const pathDb = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let db = null;

const initializeDbToServer = async () => {
  try {
    db = await open({
      filename: pathDb,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is Running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`Db Error at ${error.message}`);
    process.exit(1);
  }
};

initializeDbToServer();

const authenticateAccessToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken !== undefined) {
    jwt.verify(jwtToken, "MY_ACCESS_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }
};

// API - 1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const checkUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbResponse = await db.get(checkUserQuery);

  if (dbResponse !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const insertUserQuery = `
            INSERT INTO user(name, username, password, gender)
            VALUES (
                '${name}',
                '${username}',
                '${hashedPassword}',
                '${gender}'
            );`;
      await db.run(insertUserQuery);
      response.send("User created successfully");
    }
  }
});

//API-2
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`;
  const dbResponse = await db.get(getUserQuery);
  if (dbResponse === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordCorrect = await bcrypt.compare(
      password,
      dbResponse.password
    );
    if (isPasswordCorrect === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_ACCESS_TOKEN");
      console.log(jwtToken);
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// API-3
app.get(
  "/user/tweets/feed/",
  authenticateAccessToken,
  async (request, response) => {
    const { username, userId } = request;
    const reqQuery = `
    SELECT username, tweet, date_time as dateTime
    FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
    WHERE user.user_id IN 
    (SELECT following_user_id FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE user.username = '${username}')
    ORDER BY dateTime DESC
    LIMIT 4;`;
    const dbResponse = await db.all(reqQuery);
    response.send(dbResponse);
  }
);

// API-4
app.get(
  "/user/following/",
  authenticateAccessToken,
  async (request, response) => {
    const { username, userId } = request;
    const reqQuery = `
    SELECT name FROM user
    WHERE user.user_id IN (SELECT following_user_id FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE user.username = '${username}');`;
    const dbResponse = await db.all(reqQuery);
    response.send(dbResponse);
  }
);

//API-5
app.get(
  "/user/followers/",
  authenticateAccessToken,
  async (request, response) => {
    const { username } = request;
    const reqQuery = `
    SELECT user.name FROM follower LEFT JOIN user ON follower.follower_user_id = user.user_id
    WHERE follower.following_user_id = (SELECT user_id FROM user WHERE username = '${username}');`;
    const dbResponse = await db.all(reqQuery);
    response.send(dbResponse);
  }
);

const followingUserTweetAccessCheck = async (request, response, next) => {
  const { tweetId } = request.params;
  const { username } = request;
  const isFollowing = `
    SELECT * FROM follower
    WHERE follower_user_id = (SELECT user_id FROM user WHERE username = '${username}')
    AND following_user_id = (SELECT user.user_id FROM user NATURAL JOIN tweet WHERE tweet_id = ${tweetId});`;
  const dbResponse = await db.get(isFollowing);
  if (dbResponse === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

// API-6
app.get(
  "/tweets/:tweetId/",
  authenticateAccessToken,
  followingUserTweetAccessCheck,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const reqQuery = `
        SELECT tweet, 
        (SELECT COUNT() FROM like WHERE tweet_id = ${tweetId}) AS likes,
        (SELECT COUNT() FROM reply WHERE tweet_id = ${tweetId}) AS replies,
        date_time AS dateTime
        FROM tweet
        WHERE tweet.tweet_id = ${tweetId};`;
    const tweet = await db.get(reqQuery);
    response.send(tweet);
  }
);

//API-7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateAccessToken,
  followingUserTweetAccessCheck,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const likedUserQuery = `
    SELECT user.username FROM 
    like NATURAL JOIN user
    WHERE tweet_id = ${tweetId};`;
    const dbResponse = await db.all(likedUserQuery);
    response.send({ likes: dbResponse.map((eachUser) => eachUser.username) });
  }
);

//API-8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateAccessToken,
  followingUserTweetAccessCheck,
  async (request, response) => {
    const { tweetId } = request.params;
    const reqQuery = `
    SELECT user.name, reply.reply 
    FROM user NATURAL JOIN reply
    WHERE tweet_id = ${tweetId};`;
    const replies = await db.all(reqQuery);
    response.send({ replies });
  }
);

//API-9
app.get("/user/tweets/", authenticateAccessToken, async (request, response) => {
  const { username } = request;
  const userTweets = `
    SELECT tweet.tweet,
    COUNT(DISTINCT like.like_id) AS likes,
    COUNT(DISTINCT reply.reply_id) AS replies,
    tweet.date_time AS dateTime
    FROM tweet LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = (SELECT user_id FROM user WHERE username = '${username}')
    GROUP BY tweet.tweet_id;`;
  const dbResponse = await db.all(userTweets);
  response.send(
    dbResponse.map((eachTweet) => {
      return eachTweet;
    })
  );
});

//API-10
app.post(
  "/user/tweets/",
  authenticateAccessToken,
  async (request, response) => {
    const { tweet } = request.body;
    const { username } = request;
    const { userId } = await db.get(
      `SELECT user_id FROM user WHERE username = '${username}';`
    );
    const reqQuery = `
    INSERT INTO tweet(tweet, user_id)
    VALUES ('${tweet}', ${userId});`;
    const dbResponse = await db.run(reqQuery);
    response.send("Created a Tweet");
  }
);

//API-11
app.delete(
  "/tweets/:tweetId/",
  authenticateAccessToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const userTweet = `
    SELECT tweet_id, user_id
    FROM tweet
    WHERE tweet_id = ${tweetId}
    AND user_id = (SELECT user_id FROM user WHERE username = '${username}');`;
    const userTweetResponse = await db.get(userTweet);
    if (userTweetResponse === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const reqQuery = `
        DELETE FROM tweet
        WHERE tweet_id = ${tweetId};`;
      await db.run(reqQuery);
      response.send("Tweet Removed");
    }
  }
);
module.exports = app;
