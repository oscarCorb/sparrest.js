require('dotenv').config()

const fs = require('fs')
const cors = require('cors')
const path = require('path')
const bcrypt = require('bcrypt')
const multer = require('multer')
const JWT = require('jsonwebtoken')
const jsonServer = require('json-server')

const UPLOAD_FOLDER = process.env.UPLOAD_FOLDER || 'public/'
const AUTH_READ = process.env.AUTH_READ === 'yes' || false
const AUTH_WRITE = process.env.AUTH_WRITE === 'yes' || true
const SECRET_KEY = process.env.SECRET_KEY || 'Annie is Vader'
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '24h'
const PORT = process.env.PORT || 8000;
const SALT = bcrypt.genSaltSync(process.env.SALT || 10)

const dbFileName = process.env.DB_FILE || 'db.json'
const dbFilePath = path.join(__dirname, dbFileName)

const server = jsonServer.create();
const router = jsonServer.router(dbFilePath)
const middlewares = jsonServer.defaults()

const getDB = () => {
  const fileContents = fs.readFileSync(dbFilePath)
  return JSON.parse(fileContents)
}

const saveDB = (db) => {
  fs.writeFileSync(dbFilePath, JSON.stringify(db))
}

const getUsers = () => {
  try {
    const db = getDB()
    return Array.isArray(db.users) ? db.users : []
  } catch (err) {
    console.error('Error while retrieving users', err)
    return []
  }
}

const saveUser = (user) => {
  try {
    const db = getDB()
    if (!Array.isArray(db.users)) {
      db.users = []
    }
    db.users.push(user)
    saveDB(db)
  } catch (err) {
    console.error('Error while saving users', err)
  }
}

const getAuthenticatedUser = (username, password) => {
    const encryptedPassword = bcrypt.hashSync(password, SALT)
    const users = getUsers()
    const user = users.find(user => user.username === username)
    if (user && bcrypt.compareSync(password, user.password)) {
      return user
    }
    return null
}

const registerUser = (username, password) => {
    const encryptedPassword = bcrypt.hashSync(password, SALT)
    const users = getUsers()
    const usersExists = users.find(user => user.username === username)
    if (usersExists) {
        return false
    }
    saveUser({ id: users.length + 1, username, password: encryptedPassword })
    return true
}

const createToken = payload => JWT.sign(payload, SECRET_KEY, { expiresIn: JWT_EXPIRATION });

const verifyToken = token => JWT.verify(token, SECRET_KEY, (err, decode) => ({ err, decode }));

const checkAuth = (req, res, next) => {
  try {
    const [bearer, token] = req.headers.authorization.split(' ')
    const { err, decode } = verifyToken(token)
    if (err) {
      throw err
    }
    req.body.userId = decode.userId
    if (req.method === 'POST' || req.method === 'PUT') {
      req.body.updatedAt = new Date().toISOString()
    }
    return next();
  } catch (err) {
    const status = 401
    const message = 'Wrong access token'
    return res.status(status).json({ status, message })
  }
}

const storage = multer.diskStorage({
  destination: function(req, file, cb) {
      cb(null, UPLOAD_FOLDER);
  },
  filename: function(req, file, cb) {
      cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});

server.use(cors())
server.use(middlewares)
server.use(jsonServer.bodyParser)


server.post('/auth/login', (req, res) => {
  const { username, password } = req.body
  if (username && password) {
    const authenticatedUser = getAuthenticatedUser(username, password)
    if (!authenticatedUser) {
      const status = 401
      const message = 'Wrong username/password'
      return res.status(status).json({ message })
    }
    const accessToken = createToken({
      userId: authenticatedUser.id,
      username: authenticatedUser.username
    });
    return res.status(201).json({ accessToken })
  }
  return res.status(400).json({ message: 'username and password needed.' })
});

server.post('/auth/register', (req, res) => {
  const { username, password } = req.body
  if (username && password) {
    if (registerUser(username, password)) {
      res.status(201).json({ message: 'Registration completed' })
    }
    return res.status(400).json({ message: 'Username is taken' })
  }
  return res.status(400).json({ message: 'username and password needed.' })
});


if (AUTH_READ) {
  server.get(/^\/api/, checkAuth)
}

if (AUTH_WRITE) {
  server.put(/^\/api/, checkAuth)
  server.post(/^\/api/, checkAuth)
  server.delete(/^\/api/, checkAuth)
  server.post('/upload', checkAuth)
}

server.post('/upload', (req, res) => {
  let upload = multer({ storage }).single('file')
  upload(req, res, function(err) {
    if (req.fileValidationError) {
        return res.status(400).json({ message: req.fileValidationError });
    } else if (!req.file) {
        return res.status(400).json({ message: 'file field is required' });
    } else if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: err });
    } else if (err) {
        return res.status(400).json({ message: err });
    }
    const path = `${req.protocol}://${req.get('host')}/${req.file.path.replace(UPLOAD_FOLDER, '')}`
    return res.status(201).json({ path })
  });
})

server.use('/api/', router)
server.listen(PORT, () => { console.log(`JSON Server is running on port ${PORT}`) })
