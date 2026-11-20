const jwt = require("jsonwebtoken");

function getJwtSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET environment variable must be set in production");
  }
  return "smart_library_secret_key_2026";
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Không tìm thấy Token xác thực. Vui lòng đăng nhập!" });
  }

  let secret;
  try {
    secret = getJwtSecret();
  } catch (err) {
    return res.status(500).json({ message: "Lỗi cấu hình bảo mật máy chủ (JWT_SECRET)" });
  }

  jwt.verify(token, secret, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Token không hợp lệ hoặc đã hết hạn!" });
    }
    req.user = user;
    next();
  });
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Bạn không có quyền thực hiện hành động này!" });
    }
    next();
  };
}

module.exports = {
  authenticateToken,
  requireRole,
  getJwtSecret,
};
