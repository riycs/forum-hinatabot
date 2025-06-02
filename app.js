const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const methodOverride = require('method-override');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.set('view engine', 'ejs');
app.use(express.static('public'));

// Session setup
app.use(session({
  secret: 'supersecretkey',
  resave: false,
  saveUninitialized: false,
}));

// MongoDB connection
mongoose.connect('mongodb+srv://riycs20:threadhibot@threadhibot.pnknd2r.mongodb.net/?retryWrites=true&w=majority', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Schemas & Models
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  username: { type: String, unique: true },
  password: String,
  role: {
    type: String,
    enum: ['hinaters', 'admin', 'moderator', 'ceo', 'founder'],
    default: 'hinaters',
  },
});

const ThreadSchema = new Schema({
  title: String,
  body: String,
  authorId: { type: Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
});

const ReplySchema = new Schema({
  threadId: { type: Schema.Types.ObjectId, ref: 'Thread' },
  authorId: { type: Schema.Types.ObjectId, ref: 'User' },
  body: String,
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', UserSchema);
const Thread = mongoose.model('Thread', ThreadSchema);
const Reply = mongoose.model('Reply', ReplySchema);

// Middleware
app.use(async (req, res, next) => {
  if (req.session.userId) {
    res.locals.currentUser = await User.findById(req.session.userId);
  } else {
    res.locals.currentUser = null;
  }
  next();
});

function isLoggedIn(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

// Function admin
function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).send('Unauthorized: Silakan login terlebih dahulu');
  }  
  User.findById(req.session.userId).then(user => {
    // Roles yang diizinkan akses admin area
    const allowedRoles = ['founder', 'ceo'];
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).send('Forbidden: Anda tidak memiliki akses founder/ceo');
    }
    next();
  })
}

// Permission map per role
const permissions = {
  hinaters: ['readThread', 'createThread', 'deleteThread', 'likeThread', 'createReply'],
  admin: ['readThread', 'createThread', 'deleteThread', 'likeThread', 'createReply'],
  moderator: ['readThread', 'createThread', 'deleteThread', 'likeThread', 'createReply'],
  ceo: ['readThread', 'createThread', 'deleteThread', 'likeThread', 'createReply'],
  founder: ['readThread', 'createThread', 'deleteThread', 'likeThread', 'createReply'],
};

function checkPermission(action) {
  return (req, res, next) => {
    if (!req.session.userId) {
      return res.status(403).send('Login required');
    }
    User.findById(req.session.userId).then(user => {
      if (!user) return res.status(403).send('User not found');
      const userPermissions = permissions[user.role] || [];
      if (userPermissions.includes(action)) {
        next();
      } else {
        res.status(403).send('Forbidden: no permission');
      }
    }).catch(err => next(err));
  };
}

// Routes

// Home redirect to threads
app.get('/', (req, res) => res.redirect('/threads'));

// Register
app.get('/register', (req, res) => res.render('register'));
app.post('/register', async (req, res) => {
  if (!req.body.username) return res.render('register', { error: 'Masukkan username!' });
  if (!req.body.password) return res.render('register', { error: 'Masukkan password!' });
  try {
    const user = new User({
      username: req.body.username,
      password: req.body.password,
      role: 'hinaters', // default role
    });
    await user.save();
    req.session.userId = user._id;
    res.redirect('/threads');
  } catch (err) {
    res.render('register', { error: 'Username sudah dipakai' });
  }
});

// Login
app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
  if (!req.body.username) return res.render('login', { error: 'Masukkan username!' });
  if (!req.body.password) return res.render('login', { error: 'Masukkan password!' });
  const user = await User.findOne({ username: req.body.username });
  if (!user) return res.render('login', { error: 'User tidak ditemukan' });
  const pass = await User.findOne({ password: req.body.password });
  if (!pass) return res.render('login', { error: 'Password salah' });
  req.session.userId = user._id;
  res.redirect('/threads');
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Dashboard admin
app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const search = req.query.search || "";
    const regex = new RegExp(search, 'i');
    const users = await User.find({ username: { $regex: regex } });

    res.render('adminDashboard', {
      users,
      search,
      currentUser: req.user, // pastikan ini ada
    });
  } catch (err) {
    res.status(500).send("Error loading dashboard");
  }
});

// Ubah role user
app.put('/admin/role/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  try {
    await User.findByIdAndUpdate(id, { role });
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Terjadi kesalahan saat mengubah role.');
  }
});

// List threads with reply count and like count
app.get('/threads', async (req, res) => {
  const threads = await Thread.find().populate('authorId', 'username role').sort({ createdAt: -1 });
  const threadsWithCounts = await Promise.all(threads.map(async thread => {
    const totalReplies = await Reply.countDocuments({ threadId: thread._id });
    const totalLikes = thread.likes ? thread.likes.length : 0;
    return {
      _id: thread._id,
      title: thread.title,
      authorId: thread.authorId,
      createdAt: thread.createdAt,
      totalReplies,
      totalLikes,
    };
  }));
  res.render('threads', { threads: threadsWithCounts });
});

// Form buat thread baru
app.get('/threads/new', isLoggedIn, checkPermission('createThread'), (req, res) => {
  res.render('createThread');
});

// Simpan thread baru
app.post('/threads', isLoggedIn, checkPermission('createThread'), async (req, res) => {
  const thread = new Thread({
    title: req.body.title,
    body: req.body.body,
    authorId: req.session.userId,
  });
  await thread.save();
  res.redirect('/threads');
});

// Detail thread + replies + like status
app.get('/threads/:id', async (req, res) => {
  const thread = await Thread.findById(req.params.id).populate('authorId', 'username role').populate('likes');
  if (!thread) return res.status(404).send('Thread tidak ditemukan');
  const replies = await Reply.find({ threadId: thread._id }).populate('authorId', 'username role').sort({ createdAt: 1 });
  const totalReplies = replies.length;
  const userId = req.session.userId ? req.session.userId.toString() : null;
  const likedByCurrentUser = userId ? thread.likes.some(u => u._id.toString() === userId) : false;
  res.render('threadDetail', { thread, replies, totalReplies, likedByCurrentUser });
});

// Like/unlike thread
app.post('/threads/:id/like', isLoggedIn, checkPermission('likeThread'), async (req, res) => {
  const thread = await Thread.findById(req.params.id);
  if (!thread) return res.status(404).send('Thread tidak ditemukan');

  const userId = req.session.userId;
  if (thread.likes.includes(userId)) {
    // Unlike
    thread.likes = thread.likes.filter(id => !id.equals(userId));
  } else {
    // Like
    thread.likes.push(userId);
  }
  await thread.save();
  res.redirect(`/threads/${thread._id}`);
});

// Post reply ke thread
app.post('/threads/:id/replies', isLoggedIn, checkPermission('createReply'), async (req, res) => {
  const thread = await Thread.findById(req.params.id);
  if (!thread) return res.status(404).send('Thread tidak ditemukan');
  const reply = new Reply({
    threadId: thread._id,
    authorId: req.session.userId,
    body: req.body.body,
  });
  await reply.save();
  res.redirect(`/threads/${thread._id}`);
});

// Delete thread
app.delete('/threads/:id', isLoggedIn, checkPermission('deleteThread'), async (req, res) => {
  const thread = await Thread.findById(req.params.id);
  if (!thread) return res.status(404).send('Thread tidak ditemukan');
  // Optional: hanya pembuat thread atau admin/moderator bisa delete
  const user = await User.findById(req.session.userId);
  if (thread.authorId.equals(user._id) || ['admin', 'moderator', 'ceo', 'founder'].includes(user.role)) {
    await Thread.deleteOne({ _id: thread._id });
    await Reply.deleteMany({ threadId: thread._id }); // hapus reply terkait juga
    res.redirect('/threads');
  } else {
    res.status(403).send('Tidak punya izin hapus thread');
  }
});

// Jalankan server
app.listen(3000, async () => {
  // await Thread.deleteMany({});
  // await User.deleteMany({});
  console.log('Server running di http://localhost:3000');
});
