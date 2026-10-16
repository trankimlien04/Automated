const db = require('./config/db');

async function fixAdminPassword() {
  try {
    const hash = '$2b$10$ldh/jWZc01Ya8VHdf1HFBO.yk08WvIfLT8vkDVIGfkp6AC6CnenXm';
    await db.execute('UPDATE users SET password_hash = ? WHERE email = ?', [hash, 'admin@library.com']);
    console.log('Successfully updated admin password to 123456');
    process.exit(0);
  } catch (error) {
    console.error('Error updating password:', error);
    process.exit(1);
  }
}

fixAdminPassword();
