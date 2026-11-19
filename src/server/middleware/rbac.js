'use strict';
const { verifyToken } = require('../bll/security.js');
const { NghiepVuException, UnauthorizedException, ForbiddenException } = require('../bll/errors.js');

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, err) {
  if (err instanceof NghiepVuException) {
    return sendJson(res, err.statusCode, {
      error: {
        code: err.code,
        message: err.message,
        details: err.details || undefined,
      },
    });
  }
  console.error('[RetailFlow API Error]', err);
  return sendJson(res, 500, {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Hệ thống gặp sự cố tạm thời. Vui lòng thử lại sau.',
    },
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new NghiepVuException('Dữ liệu gửi lên vượt quá giới hạn cho phép.', 413, 'PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new NghiepVuException('Dữ liệu JSON gửi lên không hợp lệ.', 400, 'INVALID_JSON'));
      }
    });
    req.on('error', () => {
      reject(new NghiepVuException('Không thể đọc dữ liệu yêu cầu.', 400, 'READ_ERROR'));
    });
  });
}

function extractToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'rf_token') return decodeURIComponent(rest.join('='));
  }
  return '';
}

function createAuthGuards(repos) {
  function authenticate(req) {
    const token = extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Vui lòng đăng nhập để truy cập chức năng này.');
    }
    const payload = verifyToken(token);
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }
    if (payload.jti && repos.revokedTokens.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.');
    }
    const user = repos.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Tài khoản không còn tồn tại trong hệ thống.');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Quản trị viên.');
    }
    const permissions = repos.roles.getPermissionsForRole(user.role_code);
    return {
      user,
      permissions,
      tokenPayload: payload,
    };
  }

  function authorize(req, requiredPermission) {
    const auth = authenticate(req);
    if (requiredPermission && !auth.permissions.includes(requiredPermission)) {
      throw new ForbiddenException(
        `Vai trò "${auth.user.role_display_name}" không có quyền thực hiện thao tác này (${requiredPermission}).`,
      );
    }
    return auth;
  }

  return { authenticate, authorize };
}

module.exports = {
  sendJson,
  sendError,
  readJsonBody,
  extractToken,
  createAuthGuards,
};
