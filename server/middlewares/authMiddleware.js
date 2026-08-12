const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Không tìm thấy Token xác thực. Vui lòng đăng nhập!" });
  }

  jwt.verify(token, process.env.JWT_SECRET || "smart_library_secret_key_2026", (err, user) => {
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
};
