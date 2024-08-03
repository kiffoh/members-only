/////// app.js
const { Pool } = require("pg");
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require('passport-local').Strategy;
const path = require('path');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const moment = require('moment');

const pgSession = require('connect-pg-simple')(session);

const port = process.env.PORT || 3000;

const connectionString = process.env.DATABASE_URL;
/*
const pool = new Pool({
    connectionString: connectionString,
});
*/

const pool = new Pool({
    user: process.env.DATABASE_USER,
    host: process.env.DATABASE_HOST,
    database: process.env.DATABASE_NAME,
    password: process.env.DATABASE_PASSWORD,
    port: port,
});

const app = express();
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(session({
  store: new pgSession ({
    pool: pool,
    tableName: "session"
  }),
  secret: process.env.DATABASE_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {maxAge: 30 * 24 * 60 * 60 * 1000}
}));
app.use(passport.session());
app.use(express.urlencoded({ extended: false }));

passport.use(new LocalStrategy(async function verify(username, password, done) {
  try {
    const { rows } = await pool.query("SELECT * FROM userdetails WHERE username = $1", [username]);
    const user = rows[0];
    console.log(user);

    if (!user) {
      return done(null, false, {message: "Incorrect username"});
    } 
    
    const match = await bcrypt.compare(password, user.password);
    
    if (!match) {
      // passwords do not match!
      return done(null, false, { message: "Incorrect password" })
    }

    return done(null, user);

  } catch (error) {
    return done(error);
  }
}))

passport.serializeUser((user, done) => {
  done(null, user.user_id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const { rows } = await pool.query("SELECT * FROM userdetails WHERE user_id = $1", [id]);
    const user = rows[0];

    done(null, user);
  } catch(err) {
    done(err);
  }
});

app.use((req, res, next) => {
  console.log("Middleware - req.user: ", req.user);
  res.locals.currentUser = req.user;
  next();
});

// This just shows the new stuff we're adding to the existing contents
const { body, validationResult } = require("express-validator");
const asyncHandler = require("express-async-handler");
const { time } = require("console");

const alphaErr = "must only contain letters.";
const lengthErr = "must be between 1 and 10 characters.";
const emailErr = "Invalid email.";
const passwordConfirmationErr = "Password's do not match.";

const validateUser = [
  body("firstName").trim()
    .isAlpha().withMessage(`First name ${alphaErr}`)
    .isLength({ min: 1, max: 10 }).withMessage(`First name ${lengthErr}`),
  body("lastName").trim()
    .isAlpha().withMessage(`Last name ${alphaErr}`)
    .isLength({ min: 1, max: 10 }).withMessage(`Last name ${lengthErr}`),
  body("username").trim()
    .isEmail().withMessage(emailErr),
  body("passwordConfirmation")
    .custom((value, {req}) => {
      return value === req.body.password;
    }).withMessage(passwordConfirmationErr)
];


// Router
app.get("/", (req, res) => {
    res.render("index", { user: req.user });
});
  
app.get("/sign-up", (req, res) => res.render("sign-up-form"));

app.post("/sign-up", validateUser, asyncHandler(async (req, res, next) => {
  const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // If there are validation errors, re-render the form with error messages
        return res.render("sign-up-form", { 
            errors: errors.array(),
            data: req.body 
        });
    }

    bcrypt.hash(req.body.password, 10, async (err, hashedPassword) => {
        if (err) {  
            return next(err);
        } else {
            const isAdmin = req.body.admin === 'on';
            const member = isAdmin? true : false;
            await pool.query("INSERT INTO userdetails (first_name, last_name, username, password, membership_status, admin) VALUES ($1, $2, $3, $4, $5, $6)", [
              req.body.firstName,
              req.body.lastName,
              req.body.username,
              hashedPassword,
              member,
              isAdmin,
              ]);
              res.redirect("/");
        }
    })
}));

app.get("/log-out", (req, res, next) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      res.redirect("/");
    });
});  

app.post(
    "/log-in",
    passport.authenticate("local", {
      successRedirect: "/",
      failureRedirect: "/"
    })
);

function authenticatedUser (req, res, next) {
  if (req.isAuthenticated()) {
    return next()
  }
  res.redirect("/");
}

app.get("/membership-status", authenticatedUser, (req, res, next) => {
  res.render("membership-status");
})

app.post("/membership-status", authenticatedUser, async (req, res, next) => {
  const { membershipPasswordAttempt } = req.body;
  console.log("Membership Password Attempt: ", membershipPasswordAttempt);
  console.log("User data: ", req.user);

  if (membershipPasswordAttempt === "member") {
    const { user_id } = req.user;

    try {
      await pool.query(`
        UPDATE userdetails
        SET membership_status = true
        WHERE user_id = $1;
      `, [user_id]);
      console.log("Membership status updated for user: ", user_id);
    } catch (error) {
      return next(error);
    }
  }
  res.redirect("/membership-status");
});

app.get("/new-message", (req, res) => {
  if (req.user) {
    res.render("new-message-form");
  } else {
    res.redirect("/");
  }
})

app.post("/new-message", async (req, res) => {
  try {
    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss'); // Output: "2024-08-02 12:34:56" (example format)
    const { title, message } = req.body;

    await pool.query("INSERT INTO messages (user_id, title, message, timestamp) VALUES ($1, $2, $3, $4);", 
      [req.user.user_id, title, message, timestamp]);

    res.redirect("/messages");
  } catch (err) {
    next(err); // Pass the error to the error-handling middleware
  }
})

app.get("/messages", async (req, res) => {
  try {
    const { rows: messagesWithUsers } = await pool.query(`
      SELECT * 
      FROM messages
      JOIN userdetails
      ON messages.user_id = userdetails.user_id;
    `);
    res.render("messages", { messagesWithUsers });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
})

app.post("/delete-message/:id", authenticatedUser, asyncHandler(async (req, res, next) => {
  if (req.user && req.user.admin) {
    try {
      await pool.query("DELETE FROM messages WHERE message_id = $1", [req.params.id]);
      res.redirect("/messages");
    } catch (err) {
      next(err);
    }
  } else {
    res.status(403).send("You do not have permission to perform this action.");
  }
}));


app.listen(port, () => console.log(`app listening on port ${port}!`));
