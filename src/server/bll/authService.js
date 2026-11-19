'use strict';
const { withTransaction } = require('../dal/database.js');
const { hashPassword, verifyPassword, signToken } = require('./security.js');
const { NghiepVuException, UnauthorizedException, assertRule } = require('./errors.js');

function sanitizeUser(userRow, permissions = []) {
  if (!userRow) return null;
  return {
    id: userRow.id,
    username: userRow.username,
    fullName: userRow.full_name,
    name: userRow.full_name,
    email: userRow.email || '',
    phone: userRow.phone || '',
    role: userRow.role_code,
    roleDisplayName: userRow.role_display_name || userRow.role_code,
    roleShortName: userRow.role_short_name || userRow.role_code,
    status: userRow.status,
    active: userRow.status === 'ACTIVE',
    mustChangePassword: Boolean(userRow.must_change_password),
    lastLoginAt: userRow.last_login_at || null,
    createdAt: userRow.created_at,
    updatedAt: userRow.updated_at,
    permissions,
  };
}

class AuthService {
  constructor(db, repos) {
    this.db = db;
    this.repos = repos;
  }

  login(username, password) {
    const cleanUsername = String(username || '').trim();
    const cleanPassword = String(password || '');
    assertRule(cleanUsername.length > 0 && cleanPassword.length > 0, 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.', 400);

    const user = this.repos.users.findByUsername(cleanUsername);
    if (!user) {
      throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không chính xác.');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Quản trị viên.');
    }
    if (!verifyPassword(cleanPassword, user.password_hash)) {
      throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không chính xác.');
    }

    const permissions = this.repos.roles.getPermissionsForRole(user.role_code);
    const { token, exp } = signToken({
      sub: user.id,
      username: user.username,
      role: user.role_code,
    });

    const updatedUser = withTransaction(this.db, () => {
      const updated = this.repos.users.update(user.id, { last_login_at: new Date().toISOString() });
      this.repos.auditLogs.append({
        actor: updated,
        action: 'AUTH_LOGIN',
        entityType: 'User',
        entityId: updated.id,
        detail: `Đăng nhập hệ thống thành công (${updated.username} · ${updated.role_short_name}).`,
      });
      return updated;
    });

    return {
      token,
      expiresAt: new Date(exp * 1000).toISOString(),
      user: sanitizeUser(updatedUser, permissions),
    };
  }

  getProfile(userId) {
    const user = this.repos.users.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị khóa.');
    }
    const permissions = this.repos.roles.getPermissionsForRole(user.role_code);
    return sanitizeUser(user, permissions);
  }

  changePassword(actor, { currentPassword, newPassword, confirmPassword }) {
    assertRule(typeof currentPassword === 'string' && currentPassword.length > 0, 'Vui lòng nhập mật khẩu hiện tại.', 400);
    assertRule(typeof newPassword === 'string' && newPassword.length >= 6, 'Mật khẩu mới phải có tối thiểu 6 ký tự.', 400);
    assertRule(newPassword.length <= 100, 'Mật khẩu mới không được vượt quá 100 ký tự.', 400);
    assertRule(newPassword !== currentPassword, 'Mật khẩu mới phải khác mật khẩu hiện tại.', 400);
    if (confirmPassword !== undefined) {
      assertRule(newPassword === confirmPassword, 'Xác nhận mật khẩu mới không khớp.', 400);
    }

    const user = this.repos.users.findById(actor.id);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Tài khoản không hợp lệ hoặc đã bị khóa.');
    }
    if (!verifyPassword(currentPassword, user.password_hash)) {
      throw new NghiepVuException('Mật khẩu hiện tại không chính xác.', 400, 'INVALID_PASSWORD');
    }

    withTransaction(this.db, () => {
      this.repos.users.update(user.id, {
        password_hash: hashPassword(newPassword),
        must_change_password: 0,
      });
      this.repos.auditLogs.append({
        actor: user,
        action: 'AUTH_CHANGE_PASSWORD',
        entityType: 'User',
        entityId: user.id,
        detail: `Nhân viên ${user.full_name} (${user.username}) đã đổi mật khẩu tài khoản.`,
      });
    });

    return { message: 'Đổi mật khẩu thành công.' };
  }

  logout(actor, tokenPayload) {
    if (tokenPayload?.jti && actor?.id) {
      withTransaction(this.db, () => {
        this.repos.revokedTokens.revoke(tokenPayload.jti, actor.id, tokenPayload.exp);
        this.repos.auditLogs.append({
          actor,
          action: 'AUTH_LOGOUT',
          entityType: 'User',
          entityId: actor.id,
          detail: `Đăng xuất khỏi hệ thống (${actor.username}).`,
        });
      });
    }
    return { message: 'Đã đăng xuất thành công.' };
  }
}

module.exports = {
  AuthService,
  sanitizeUser,
};
