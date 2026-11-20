'use strict';
const { withTransaction } = require('../dal/database.js');
const { hashPassword } = require('./security.js');
const { sanitizeUser } = require('./authService.js');
const { ConflictException, NotFoundException, assertRule } = require('./errors.js');

const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,40}$/;
const PHONE_REGEX = /^$|^\+?[\d\s().-]{8,18}$/;
const EMAIL_REGEX = /^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class StaffService {
  constructor(db, repos) {
    this.db = db;
    this.repos = repos;
  }

  listStaff(filters = {}) {
    const rows = this.repos.users.list(filters);
    return rows.map((row) => sanitizeUser(row));
  }

  listRoles() {
    return this.repos.roles.findAll();
  }

  createStaff(actor, input) {
    const fullName = String(input.fullName || input.name || '').trim();
    const username = String(input.username || '').trim();
    const password = String(input.password || '');
    const roleCode = String(input.role || input.role_code || '').trim();
    const phone = String(input.phone || '').trim();
    const email = String(input.email || '').trim();
    const status = input.status === 'LOCKED' || input.active === false ? 'LOCKED' : 'ACTIVE';

    assertRule(fullName.length >= 2 && fullName.length <= 150, 'Họ và tên nhân viên phải từ 2 đến 150 ký tự.', 400);
    assertRule(
      USERNAME_REGEX.test(username),
      'Tên đăng nhập gồm 3–40 ký tự chữ, số hoặc (_ . -), không dấu và không khoảng trắng.',
      400,
    );
    assertRule(password.length >= 6 && password.length <= 100, 'Mật khẩu phải từ 6 đến 100 ký tự.', 400);
    assertRule(PHONE_REGEX.test(phone), 'Số điện thoại không đúng định dạng hợp lệ.', 400);
    assertRule(EMAIL_REGEX.test(email), 'Email không đúng định dạng hợp lệ.', 400);

    const role = this.repos.roles.findByCode(roleCode);
    assertRule(Boolean(role), 'Vai trò được chọn không tồn tại trong hệ thống.', 400);

    const dup = this.repos.users.findByUsername(username);
    if (dup) {
      throw new ConflictException(`Tên đăng nhập "${username}" đã tồn tại trong hệ thống.`);
    }

    const supplierId = String(input.supplierId || input.supplier_id || '').trim() || null;
    if (roleCode === 'SUPPLIER') {
      assertRule(Boolean(supplierId), 'Tài khoản vai trò Nhà cung cấp bắt buộc gắn với một Nhà cung cấp.', 400);
    }

    const created = withTransaction(this.db, () => {
      const record = this.repos.users.create({
        username,
        password_hash: hashPassword(password),
        full_name: fullName,
        email,
        phone,
        role_code: roleCode,
        supplier_id: roleCode === 'SUPPLIER' ? supplierId : null,
        status,
      });
      this.repos.auditLogs.append({
        actor,
        action: 'STAFF_CREATE',
        entityType: 'User',
        entityId: record.id,
        detail: `Tạo tài khoản nhân viên ${record.full_name} (${record.username}) với vai trò ${role.display_name}.`,
        after: { id: record.id, username: record.username, role: record.role_code, status: record.status },
      });
      return record;
    });

    return sanitizeUser(created);
  }

  updateStaff(actor, id, input) {
    const existing = this.repos.users.findById(id);
    if (!existing) {
      throw new NotFoundException('Không tìm thấy tài khoản nhân viên cần cập nhật.');
    }

    const fullName = String(input.fullName || input.name || existing.full_name).trim();
    const roleCode = String(input.role || input.role_code || existing.role_code).trim();
    const phone = input.phone !== undefined ? String(input.phone).trim() : existing.phone;
    const email = input.email !== undefined ? String(input.email).trim() : existing.email;
    const nextStatus =
      input.status !== undefined
        ? String(input.status).trim()
        : input.active !== undefined
          ? input.active
            ? 'ACTIVE'
            : 'LOCKED'
          : existing.status;

    assertRule(fullName.length >= 2 && fullName.length <= 150, 'Họ và tên nhân viên phải từ 2 đến 150 ký tự.', 400);
    assertRule(['ACTIVE', 'LOCKED'].includes(nextStatus), 'Trạng thái tài khoản chỉ chấp nhận ACTIVE hoặc LOCKED.', 400);
    assertRule(PHONE_REGEX.test(phone), 'Số điện thoại không đúng định dạng hợp lệ.', 400);
    assertRule(EMAIL_REGEX.test(email), 'Email không đúng định dạng hợp lệ.', 400);

    const role = this.repos.roles.findByCode(roleCode);
    assertRule(Boolean(role), 'Vai trò được chọn không tồn tại trong hệ thống.', 400);

    // Protect current logged-in Admin from self-lock or self-demote
    if (existing.id === actor.id) {
      assertRule(nextStatus === 'ACTIVE', 'Không thể tự khóa tài khoản Quản trị viên đang đăng nhập.', 400);
      assertRule(roleCode === 'ADMIN', 'Không thể tự hạ quyền tài khoản Quản trị viên đang đăng nhập.', 400);
    }

    // Ensure at least one ACTIVE Admin always remains
    if (existing.role_code === 'ADMIN' && (nextStatus !== 'ACTIVE' || roleCode !== 'ADMIN')) {
      const otherAdmins = this.repos.users.countActiveAdmins(existing.id);
      assertRule(otherAdmins > 0, 'Hệ thống bắt buộc phải giữ ít nhất một Quản trị viên (Admin) đang hoạt động.', 400);
    }

    const supplierId =
      input.supplierId !== undefined || input.supplier_id !== undefined
        ? String(input.supplierId ?? input.supplier_id ?? '').trim() || null
        : existing.supplier_id || null;
    const updateFields = {
      full_name: fullName,
      email,
      phone,
      role_code: roleCode,
      supplier_id: roleCode === 'SUPPLIER' ? supplierId : null,
      status: nextStatus,
    };

    const newPassword = typeof input.password === 'string' ? input.password : '';
    if (newPassword.length > 0) {
      assertRule(newPassword.length >= 6 && newPassword.length <= 100, 'Mật khẩu mới phải từ 6 đến 100 ký tự.', 400);
      updateFields.password_hash = hashPassword(newPassword);
    }

    const updated = withTransaction(this.db, () => {
      const rec = this.repos.users.update(existing.id, updateFields);
      const changes = [];
      if (existing.role_code !== rec.role_code) changes.push(`vai trò ${existing.role_code} → ${rec.role_code}`);
      if (existing.status !== rec.status) changes.push(`trạng thái ${existing.status} → ${rec.status}`);
      if (newPassword) changes.push('đặt lại mật khẩu');
      if (existing.full_name !== rec.full_name) changes.push(`tên "${rec.full_name}"`);

      this.repos.auditLogs.append({
        actor,
        action: existing.status !== rec.status ? (rec.status === 'LOCKED' ? 'STAFF_LOCK' : 'STAFF_UNLOCK') : 'STAFF_UPDATE',
        entityType: 'User',
        entityId: rec.id,
        detail: `Cập nhật nhân viên ${rec.full_name} (${rec.username})${changes.length ? `: ${changes.join(', ')}` : ''}.`,
        before: { fullName: existing.full_name, role: existing.role_code, status: existing.status },
        after: { fullName: rec.full_name, role: rec.role_code, status: rec.status },
      });
      return rec;
    });

    return sanitizeUser(updated);
  }

  setStaffStatus(actor, id, targetStatus) {
    assertRule(['ACTIVE', 'LOCKED'].includes(targetStatus), 'Trạng thái phải là ACTIVE hoặc LOCKED.', 400);
    return this.updateStaff(actor, id, { status: targetStatus });
  }
}

module.exports = { StaffService };
