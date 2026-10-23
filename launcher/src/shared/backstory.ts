import type { Me } from './types';

/** Why "Играть" is locked for this player; null if they may play. The server enforces the same rule. */
export function playBlockReason(me: Pick<Me, 'isAdmin' | 'backstoryStatus' | 'backstoryReview'>): string | null {
  if (me.isAdmin || me.backstoryStatus === 'approved') return null;
  switch (me.backstoryStatus) {
    case 'none':
      return 'Заполните квенту персонажа на вкладке «Квента»: без неё на сервер не пустят.';
    case 'pending':
      return 'Квента ждёт одобрения администратора.';
    default:
      return `Квента отклонена администратором${me.backstoryReview ? `: ${me.backstoryReview}` : ''}. Исправьте её на вкладке «Квента».`;
  }
}
