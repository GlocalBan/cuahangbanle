function handleReturnsAction(a) {
  switch (a.action) {
    case 'return-new':
      returnModal(a.id || '');
      break;

    case 'return-search':
      searchReturn();
      break;

    case 'return-detail':
      returnDetail(a.id);
      break;

    case 'return-approve': {
      const rid = a.id;
      confirmation(
        'Xác nhận đã hoàn tiền cho khách?',
        'Phiếu được duyệt sẽ cập nhật số lượng đã trả, ghi nhận tiền hoàn và nhập lại kho nếu hàng đủ điều kiện.',
        () => {
          store.admin();
          store.resolveReturn(rid, true);
          render();
          returnDetail(rid);
          notify('Đã ghi nhận hoàn tiền và cập nhật hàng trả.');
        },
      );
      break;
    }

    case 'return-reject': {
      const rid = a.id;
      confirmation(
        'Từ chối yêu cầu trả hàng?',
        'Yêu cầu sẽ được đóng và không làm thay đổi tiền hay tồn kho.',
        () => {
          store.admin();
          store.resolveReturn(rid, false);
          render();
          returnDetail(rid);
        },
      );
      break;
    }

    default:
      return false;
  }
  return true;
}
