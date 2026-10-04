export const ASSISTANT_ACTIONS = Object.freeze({
  START_ORDER: 'START_ORDER',
  VIEW_ORDER: 'VIEW_ORDER',
  VIEW_REQUEST: 'VIEW_REQUEST',
  VIEW_DELIVERY: 'VIEW_DELIVERY',
  OPEN_REQUESTS: 'OPEN_REQUESTS',
  OPEN_SCHEDULE: 'OPEN_SCHEDULE',
  OPEN_HISTORY: 'OPEN_HISTORY',
  OPEN_NOTIFICATIONS: 'OPEN_NOTIFICATIONS',
  MANAGE_DELIVERY_LOCATION: 'MANAGE_DELIVERY_LOCATION',
  VIEW_PROFILE: 'VIEW_PROFILE',
  CONTACT_REQUESTER: 'CONTACT_REQUESTER',
  CONTACT_STATION: 'CONTACT_STATION',
});

export const ALLOWED_ACTION_TYPES = new Set(Object.values(ASSISTANT_ACTIONS));

export function isAllowedActionType(type) {
  return typeof type === 'string' && ALLOWED_ACTION_TYPES.has(type);
}

export function createAction(type, payload = {}) {
  if (!isAllowedActionType(type)) {
    throw new Error(`Unauthorized or unknown assistant action type: ${type}`);
  }
  return {
    type,
    ...payload,
  };
}

export async function executeAssistantAction(action = {}, context = {}) {
  const { type, orderId, branchId, targetRole } = action;
  const { router, chat, role = 'requester' } = context;
  const activeRole = String(targetRole || role || 'requester').toLowerCase();
  const isDistributor = activeRole === 'distributor';

  if (!isAllowedActionType(type)) {
    throw new Error(`Cannot execute unknown assistant action type: ${type}`);
  }

  switch (type) {
    case ASSISTANT_ACTIONS.START_ORDER:
      if (router?.push) {
        router.push('/requester/requestform');
      }
      return { handled: true, target: '/requester/requestform' };

    case ASSISTANT_ACTIONS.VIEW_ORDER:
    case ASSISTANT_ACTIONS.VIEW_REQUEST:
      if (orderId && router?.push) {
        router.push({
          pathname: '/requester/r_request',
          params: { orderId: String(orderId) },
        });
        return { handled: true, target: '/requester/r_request', orderId };
      }
      if (router?.push) {
        router.push('/requester/r_request');
      }
      return { handled: true, target: '/requester/r_request' };

    case ASSISTANT_ACTIONS.VIEW_DELIVERY:
      if (orderId && router?.push) {
        router.push({
          pathname: '/distributor/d_scheduled_requests',
          params: { orderId: String(orderId) },
        });
        return { handled: true, target: '/distributor/d_scheduled_requests', orderId };
      }
      if (router?.push) {
        router.push('/distributor/d_scheduled_requests');
      }
      return { handled: true, target: '/distributor/d_scheduled_requests', orderId };

    case ASSISTANT_ACTIONS.OPEN_SCHEDULE:
      if (router?.push) {
        router.push('/distributor/d_scheduled_requests');
      }
      return { handled: true, target: '/distributor/d_scheduled_requests' };

    case ASSISTANT_ACTIONS.OPEN_HISTORY:
      if (router?.push) {
        router.push('/distributor/d_history');
      }
      return { handled: true, target: '/distributor/d_history' };

    case ASSISTANT_ACTIONS.OPEN_REQUESTS:
      if (isDistributor) {
        if (router?.push) {
          router.push('/distributor/d_requests');
        }
        return { handled: true, target: '/distributor/d_requests' };
      }
      if (router?.push) {
        router.push('/requester/r_request');
      }
      return { handled: true, target: '/requester/r_request' };

    case ASSISTANT_ACTIONS.OPEN_NOTIFICATIONS:
      if (isDistributor) {
        if (router?.push) {
          router.push('/distributor/d_notification');
        }
        return { handled: true, target: '/distributor/d_notification' };
      }
      if (router?.push) {
        router.push('/requester/r_notification');
      }
      return { handled: true, target: '/requester/r_notification' };

    case ASSISTANT_ACTIONS.MANAGE_DELIVERY_LOCATION:
    case ASSISTANT_ACTIONS.VIEW_PROFILE:
      if (isDistributor) {
        if (router?.push) {
          router.push('/distributor/d_profile');
        }
        return { handled: true, target: '/distributor/d_profile' };
      }
      if (router?.push) {
        router.push('/requester/r_profile');
      }
      return { handled: true, target: '/requester/r_profile' };

    case ASSISTANT_ACTIONS.CONTACT_REQUESTER:
      if (chat?.resolveAndOpen && orderId) {
        await chat.resolveAndOpen({
          type: 'requester_distributor',
          orderId: String(orderId).trim(),
        });
        return { handled: true, target: 'chat:requester_distributor', orderId };
      }
      if (chat?.openChat) {
        chat.openChat();
        return { handled: true, target: 'chat:open' };
      }
      if (router?.push) {
        router.push('/distributor/d_scheduled_requests');
      }
      return { handled: true, target: '/distributor/d_scheduled_requests' };

    case ASSISTANT_ACTIONS.CONTACT_STATION:
      if (isDistributor) {
        if (chat?.openStationChat) {
          await chat.openStationChat();
          return { handled: true, target: 'chat:distributor_branch' };
        }
        if (chat?.resolveAndOpen) {
          const existing = (chat?.conversations || []).find((c) => c.type === 'distributor_branch');
          if (existing && chat?.openConversation) {
            chat.openConversation(existing);
            return { handled: true, target: 'chat:distributor_branch' };
          }
          await chat.resolveAndOpen({
            type: 'distributor_branch',
          });
          return { handled: true, target: 'chat:distributor_branch' };
        }
        if (chat?.openChat) {
          chat.openChat();
          return { handled: true, target: 'chat:open' };
        }
        if (router?.push) {
          router.push('/distributor/d_dashboard');
        }
        return { handled: true, target: '/distributor/d_dashboard' };
      }

      // Requester Branch Contact
      if (chat?.resolveAndOpen && branchId) {
        await chat.resolveAndOpen({
          type: 'requester_branch',
          branchId: String(branchId).trim(),
          intent: 'inquiry',
        });
        return { handled: true, target: 'chat:requester_branch', branchId };
      }
      if (chat?.openStationChat && branchId) {
        await chat.openStationChat(String(branchId).trim());
        return { handled: true, target: 'chat:requester_branch', branchId };
      }
      if (chat?.openChat) {
        chat.openChat();
        return { handled: true, target: 'chat:open' };
      }
      if (router?.push) {
        router.push('/requester/r_dashboard');
      }
      return { handled: true, target: '/requester/r_dashboard' };

    default:
      throw new Error(`Unhandled action: ${type}`);
  }
}
