const express = require("express");
const serverless = require("serverless-http");
const fetch = require("cross-fetch");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const multer = require("multer");
const { json, request } = require("express");
const app = express();
const PORT = 8000;
const router = express.Router();


app.use(express.static("uploads"));

var corsOptions = {
  origin: ["http://localhost:8080", "http://localhost:3000"],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());

const DIR = "./uploads";

// File Upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, DIR);
  },
  filename: (req, file, cb) => {
    const fileName =
      "image_" +
      "_" +
      parseInt(Math.random(2) * 1000) +
      "_" +
      Date.now() +
      "." +
      file.mimetype.split("/").pop();
    cb(null, fileName);
  },
});

var upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype == "image/png" ||
      file.mimetype == "image/jpg" ||
      file.mimetype == "image/jpeg"
    ) {
      cb(null, true);
    } else {
      cb(null, false);
      return cb(new Error("Only .png, .jpg and .jpeg format allowed!"));
    }
  },
});

const HASURA_ENDPOINT = "https://recepie.hasura.app/v1/graphql";
const HASURA_ADMIN_SECRET =
  "qS3ZBKFUupK316SCcrO3Wgkehg9lFvoNRtynkQPesqtG3XODvUBSC5Lm1YDo1Y3u";

const HASURA_GRAPHQL_JWT_SECRET = "Ggx2g7m88A5f0rmlQfVwti4MshCB6IR1";
const JWT_EXPIRE_TIME = "60m";

const makeGraphQLClient =
  ({ url, headers }) =>
  async ({ query, variables }) => {
    const request = await fetch(url, {
      headers,
      method: "POST",
      body: JSON.stringify({ query, variables }),
    });
    return request.json();
  };

const sendQuery = makeGraphQLClient({
  url: HASURA_ENDPOINT,
  headers: {
    "X-Hasura-Admin-Secret": HASURA_ADMIN_SECRET,
  },
});

function generateJWT({ allowedRoles, defaultRole, x_hasura_user_id }) {
  const payload = {
    claims: {
      "x-hasura-allowed-roles": allowedRoles,
      "x-hasura-default-role": defaultRole,
      "x-hasura-user-id": x_hasura_user_id,
    },
  };
  return jwt.sign(payload, HASURA_GRAPHQL_JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: JWT_EXPIRE_TIME,
  });
}



router.post("/api/actions/signup", async (req, res) => {
  const email = req.body.email;
  const hashedPassword = await bcrypt.hash(req.body.password, 10);
  const request = await sendQuery({
    query: `
      mutation insertUser {
        insert_users_one(object: {email: "${email}", password: "${hashedPassword}"}) {
          email
          id
        }
      }`,
  });

  if (request.errors) {
    console.log(request.errors[0].message);
    res.json({ Error: "User already exists!" });
  }
  const token = generateJWT({
    defaultRole: "user",
    allowedRoles: ["user"],
    x_hasura_user_id: await request.data.insert_users_one.id,
  });
  const userEmail = request.data.insert_users_one.email;
  const userId = request.data.insert_users_one.id;
  res.json({ token, userEmail, userId });
});

router.post("/api/actions/login", async (req, res) => {
  const request = await sendQuery({
    query: `
    query {
      users(where: {email: {_similar: "${req.body.signin_email}"}}) {
        id
        email
        password
      }
    }
    `,
  });

  const dbUser = request.data.users[0];
  if (!dbUser) {
    return res.json({ error: "Invalid Username or Password" });
  }
  const validPassword = bcrypt.compareSync(
    req.body.signin_password,
    dbUser.password
  );
  if (!validPassword) return res.status(400).json({ error: "Invalid" });
  const token = generateJWT({
    defaultRole: "user",
    allowedRoles: ["user"],
    x_hasura_user_id: dbUser.id,
  });
  userId = await dbUser.id;
  userEmail = await dbUser.email;
  return res.json({ token, userId, userEmail });
});

router.post("/api/actions/upload/:id", upload.array("files"), async (req, res) => {
  var images = [];

  for (const i in req.files) {
    if (Object.hasOwnProperty.call(req.files, i)) {
      images.push({
        filename: req.files[i].filename,
        recipe_id: parseInt(req.params.id),
      });
    }
  }

  const request = await sendQuery({
    query: `
      mutation {
        insert_uploads(objects: ${JSON.stringify(images).replace(
          /"([^"]+)":/g,
          "$1:"
        )} ){
          returning{
            id
            filename
            recipe_id
          }
        }
      }
      `,
  });
  // console.log(request)

  res.json(request.data);
});

router.post("/api/actions/new", async (req, res) => {
  // console.log(JSON.stringify(req.body));
  var result = [];
  var ingridients = [];
  var steps = [];

  await sendQuery({
    query: `
        mutation {
          insert_recipes_one(object: {
            category: "${req.body.category}",
            description: "${req.body.description}",
            duration: "${req.body.duration}",
            title: "${req.body.title}",
            creator: "${req.body.user}"}) {
              id
              title
              category
              description
              duration
              creator
            }
          }
          `,
  }).then((recipe) => {
    console.log(recipe);
    if (recipe.errors) {
      console.log(error);
      return res.json(error);
    } else {
      const rec_id = recipe.data.insert_recipes_one.id;
      result.push(recipe.data);
      req.body.steps.forEach(async (element, index) => {
        await sendQuery({
          query: `
          mutation {
            insert_steps_one(object: {recipe_id: ${rec_id}, step: "${element}", stepNumber: ${index}}) {
              id
              recipe_id
              step
              stepNumber
            }
          }`,
        });
      });
      req.body.ingridients.forEach(async (element, index) => {
        await sendQuery({
          query: `
        mutation {
          insert_ingredients(objects: {ingredient: "${element}", recipe_id: ${rec_id}}){
            returning{
              id
              ingredient
              recipe_id
            }
          }
        }
        `,
        });
      });
    }
  });
  console.log("sent:" + result);
  res.json(result);
});

router.get("/api/actions/recipes/:userId", async (req, res) => {
  const request = await sendQuery({
    query: `
        query ( $_creator: uuid = "${req.params.userId}") {
          recipes(where: {creator: {_eq: $_creator}}) {
            id
            title
            description
            uploads {
              id
              filename
              recipe_id
            }
          } 
        }
      `,
  });
  console.log(request);
  if (request.errors) {
    console.log(req.errors);
  } else {
    const dbData = request.data.recipes;
    return res.json({ recipes: dbData });
  }
});
router.get("/api/actions/recipe/:recipeId", async (req, res) => {
  const request = await sendQuery({
    query: `
      query ($_eq: Int = ${req.params.recipeId}) {
        recipes(where: {id: {_eq: $_eq}}) {
          id
          title
          description
          duration
          creator
          category
          created_at
          updated_at
          uploads {
            filename
            id
            recipe_id
          }
        }
        steps(where: {recipe_id: {_eq: $_eq}}) {
          id
          step
          stepNumber
          recipe_id
        }
        ingredients(where: {recipe_id: {_eq: $_eq}}) {
          id
          ingredient
          recipe_id
        }
      }
      `,
  });
  console.log(request);
  if (request.errors) {
    console.log(req.errors);
  } else {
    const dbData = request.data;
    console.log(JSON.stringify(dbData));
    return res.json({ result: dbData });
  }
});

router.get("/", (req, res) => {
  res.json({
    hello: "hi!"
  });
});

app.use(`/.netlify/functions/`, router);

module.exports = app;
module.exports.handler = serverless(app);
