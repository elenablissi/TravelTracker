import bodyParser from "body-parser";
import express from "express";
import session from 'express-session';
import passport from './auth.js';
import bcrypt from "bcrypt";
import db from './database.js';

const app = express();
const port = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Session Configuration
app.use(session({
  secret: 'super_duper_secret_key', // Should be in .env
  resave: false,
  saveUninitialized: false
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Set View Engine to EJS
app.set('view engine', 'ejs');

// Members
var currentMemberId = -1;
var members = [];

// Functions
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
      return next();
  }
  res.redirect('/login');
}

async function checkVisisted(user_id, countryCode = true) {
  let countries = [];

  if (currentMemberId > -1) {
    var result;

    if (countryCode) {
      result = await db.query(
        "SELECT country_code FROM visited_countries WHERE user_id = $1 AND member_id = $2;",
        [user_id, currentMemberId]
      );
      result.rows.forEach((country) => {
        countries.push(country.country_code);
      });
    } else {
      result = await db.query(
        "SELECT countries.country_name, countries.country_code FROM countries JOIN visited_countries ON countries.country_code = visited_countries.country_code WHERE visited_countries.user_id = $1 AND visited_countries.member_id = $2;",
        [user_id, currentMemberId]
      );
      result.rows.forEach((country) => {
        countries.push({
          code: country.country_code,
          name: country.country_name,
        });
      });
    }
  }
  return countries;
}

async function getMembers(user_id) {
  const result = await db.query("SELECT * FROM members WHERE user_id = $1",[user_id]);
  return result.rows;
}

async function getCurrentMember() {
  if (members.length < 1) { 
    return null;
  }
  let foundMember = members.find((member) => member.id == currentMemberId);
  
  if (!foundMember) {
    currentMemberId = members[0].id;  // Fallback to first member
    return members[0];
  }

  return foundMember;
}

// Routes //
// Index
app.get("/", ensureAuthenticated, async (req, res) => {
  members = await getMembers(req.user.id);

  const firstName = req.user.name;

  if (members.length > 0) {
    const currentMember = await getCurrentMember();

    if (!currentMember) {
      return res.render("index.ejs", {
        firstName: firstName,
        countries: [],
        total: 0,
        members: members,
        color: "", // Default color to prevent errors
        session: req.session
      });
    }

    const countries = await checkVisisted(req.user.id);
    res.render("index.ejs", {
      firstName: firstName,
      countries: countries,
      total: countries.length,
      members: members,
      color: currentMember.color || "",
      session: req.session
    });
  }
  else {
    res.render("index.ejs", {
      firstName: firstName,
      countries: [],
      total: 0,
      members: [],
      color: "",
      session: req.session
    });
  }
});

// Register
app.get("/register", async (req, res) => {
  res.render("register.ejs" , {
    session: req.session
  });
});

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  // Check if the email already exists
  const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  if (result.rows.length > 0) {
    req.session.error = "Email is already in use.";
    return res.redirect("/register");
  }

  // Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Store user in the database 
  try {
    const result = await db.query('INSERT INTO users (name, email, password) VALUES ($1, $2, $3)', [name, email, hashedPassword]);
    const user = result.rows[0];
    req.login(user, (err) => {
      res.redirect("/");
    });
  } catch (err) {
      console.error(err);
      req.session.error = err.message;
      res.redirect('/register');
  }
});

// Log in
app.get("/login", async (req, res) => {
  res.render("login.ejs");
});

app.post('/login', passport.authenticate('local', {
  successRedirect: '/', 
  failureRedirect: '/login', 
}));

// Index buttons
app.post("/member", async (req, res) => {
  if (req.body.add === "new") 
  {
    res.render("new.ejs");
  } 
  else if (req.body.memberToEdit) 
  {
    const memberData = members.find((member) => member.id == req.body.memberToEdit);
    currentMemberId = memberData.id;
    const countries = await checkVisisted(req.user.id, false);
    res.render("edit.ejs", {
      currentMemberData: memberData,
      visitedCountries: countries,
    });
  } 
  else 
  {
    currentMemberId = req.body.member;
    res.redirect("/");
  }
});

// New member
app.post("/new", async (req, res) => {
  const name = req.body.name;
  const color = req.body.color;

  const result = await db.query(
    "INSERT INTO members (user_id, name, color) VALUES($1, $2, $3) RETURNING *;",
    [req.user.id, name, color]
  );

  const id = result.rows[0].id;
  currentMemberId = id;

  res.redirect("/");
});

// Edit member
app.post("/edit", async (req, res) => {
  const id = req.body.id;
  const name = req.body.name;
  const color = req.body.color;
  const deletedCountries = req.body.countriesToDelete;

  try {
      const result = await db.query(
          "UPDATE members SET name = $1, color = $2 WHERE user_id = $3 AND id = $4 RETURNING *;",
          [name, color, req.user.id, id]
      );

      if (result.rowCount === 0) {
          return res.status(404).json({ message: "Record not found" });
      } 

      if (deletedCountries !== "") {
        const deletedCodeCountries = deletedCountries.split(',').filter(item => item !== "");

        const resultCountries = await db.query("DELETE FROM visited_countries WHERE user_id = $1 AND member_id = $2 AND country_code = ANY($3) RETURNING *;", 
          [req.user.id, id, deletedCodeCountries]
        );

        if (resultCountries.rowCount === 0) {
          return res.status(404).json({ message: "Country record not found" });
        } 
      }
  } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
  }

  res.redirect("/");
});


app.post("/delete-member", async (req, res) => {
  const memberId = req.body.id;

  try {
    // Delete visited countries associated with the member first
    await db.query("DELETE FROM visited_countries WHERE member_id = $1 AND user_id = $2", [memberId, req.user.id]);

    // Delete the member
    const result = await db.query("DELETE FROM members WHERE id = $1 AND user_id = $2 RETURNING *", [memberId, req.user.id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Member not found" });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});


// Search country
app.get('/search', async (req, res) => {
  const searchQuery = req.query.query;
  if (!searchQuery) return res.json([]);

  function toTitleCase(str) {
    return str.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  }

  const formattedQuery = toTitleCase(searchQuery);

  try {
      const result = await db.query(
          "SELECT country_name FROM countries WHERE country_name LIKE $1 LIMIT 5",
          [`%${formattedQuery}%`]
      );
      res.json(result.rows.map(row => row.country_name));
  } catch (error) {
      console.error(error);
      res.status(500).send("Server error");
  }
});

// Add countries
app.post("/add", async (req, res) => {
  const input = req.body["country"].trim();
  const currentMember = await getCurrentMember();

  try {
    const result = await db.query(
      "SELECT country_code FROM countries WHERE LOWER(country_name) LIKE $1",
      [input.toLowerCase()]
    );
    
    if (result.rowCount < 1) {
      req.session.error = 'No country found.';
      return res.redirect("/");
    }
    const data = result.rows[0];
    const countryCode = data.country_code;
    try {
      await db.query(
        "INSERT INTO visited_countries (country_code, user_id, member_id) VALUES ($1, $2, $3)",
        [countryCode, req.user.id, currentMemberId]
      );
      res.redirect("/");
    } catch (err) {
      if (err.code === '23505') {
        req.session.error = 'This country has already been added by this member.';
      } else {
        req.session.error = err.error;
      }
      res.redirect("/");
    }
  } catch (err) {
    console.log(err);
    req.session.error = err.error;
    res.redirect("/");
  }
});

// Log out
app.get('/logout', (req, res, next) => {
  req.logout(function(err) {
      if (err) {
          return next(err);
      }
      res.redirect('/login'); // Redirect to login after logout
  });
});

// Start Server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
