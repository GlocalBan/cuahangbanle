'use strict';

class NghiepVuException extends Error {
  constructor(message, statusCode = 400, code = 'BUSINESS_ERROR', details = null) {
    super(message);
    this.name = 'NghiepVuException';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

class UnauthorizedException extends NghiepVuException {
  constructor(message = 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedException';
  }
}

class ForbiddenException extends NghiepVuException {
  constructor(message = 'Bạn không có quyền thực hiện thao tác này.') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenException';
  }
}

class NotFoundException extends NghiepVuException {
  constructor(message = 'Không tìm thấy dữ liệu yêu cầu.') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundException';
  }
}

class ConflictException extends NghiepVuException {
  constructor(message = 'Dữ liệu đã tồn tại hoặc xung đột trạng thái.') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictException';
  }
}

function assertRule(condition, message, statusCode = 400, code = 'BUSINESS_ERROR', details = null) {
  if (!condition) {
    throw new NghiepVuException(message, statusCode, code, details);
  }
}

module.exports = {
  NghiepVuException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  assertRule,
};
