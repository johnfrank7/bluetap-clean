import {
  ASSISTANT_INTENTS,
  detectLanguage,
  classifyIntent,
} from './assistantIntents';
import {
  ASSISTANT_ACTIONS,
  createAction,
} from './assistantActions';

export class DeterministicAssistantEngine {
  constructor() {
    this.name = 'DeterministicOperationalEngine';
  }

  async respond({ userInput = '', safeContext = {}, history = [], forcedIntent = null, role = null } = {}) {
    const activeRole = String(role || safeContext.role || 'requester').toLowerCase();
    const language = detectLanguage(userInput);
    const knownIntents = new Set(Object.values(ASSISTANT_INTENTS));

    let intent = ASSISTANT_INTENTS.UNKNOWN;
    if (forcedIntent && knownIntents.has(forcedIntent)) {
      intent = forcedIntent;
    } else {
      intent = classifyIntent(userInput, activeRole);
    }

    const isCeb = language === 'ceb';

    if (activeRole === 'distributor') {
      return handleDistributorQuery({ intent, isCeb, safeContext, userInput, history });
    }

    return handleRequesterQuery({ intent, isCeb, safeContext, userInput, history });
  }
}

export function handleRequesterQuery({ intent, isCeb, safeContext = {}, userInput = '', history = [] }) {
  const requesterName = safeContext.requester?.firstName || 'Requester';
  const activeOrder = safeContext.activeOrder || null;
  const hasActive = Boolean(activeOrder);

  let message = '';
  const cards = [];
  const actions = [];

  switch (intent) {
      case ASSISTANT_INTENTS.GREETING: {
        if (isCeb) {
          message = `Maayong adlaw, ${requesterName}! 👋 Ako ang imong BlueTap Assistant. Unsay akong ikatabang nimo karon? Makatabang ko sa pagsubay sa imong order, pagtan-aw sa iskedyul sa delivery, pagpangita og water station, o mga pangutana sa account.`;
        } else {
          message = `Hello, ${requesterName}! 👋 I'm your BlueTap Assistant. How can I help you today? You can track your water requests, check delivery schedules, find nearby water stations, or ask account questions.`;
        }

        if (hasActive) {
          cards.push({
            type: 'order',
            ...activeOrder,
          });
          actions.push(createAction(ASSISTANT_ACTIONS.VIEW_ORDER, {
            label: isCeb ? 'Tan-awa ang Order' : 'Track Order',
            orderId: activeOrder.id,
          }));
        } else {
          actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
            label: isCeb ? 'Mag-order og Tubig' : 'Start an Order',
          }));
        }
        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_REQUESTS, {
          label: isCeb ? 'Tan-awa ang Requests' : 'View Requests',
        }));
        break;
      }

      case ASSISTANT_INTENTS.HOW_BLUETAP_WORKS: {
        if (isCeb) {
          message = `Mao kini ang paggamit sa BlueTap sa 3 ka sayon nga lakang:\n\n1. Pag-request og Tubig: Pilia ang imong gusto nga water station, klase sa container, ug delivery address.\n2. Pag-review ug Iskedyul: Mo-review ang water station sa imong request ug magtakda og iskedyul sa delivery.\n3. Paghatod sa Distributor: Ang usa ka distributor maoy maghatod sa imong mineral water diretso sa imong pultahan.`;
        } else {
          message = `Here is how BlueTap works in 3 easy steps:\n\n1. Request Water: Choose your preferred water station, container type, and delivery address.\n2. Branch Review & Schedule: The water station reviews your request and schedules a delivery time.\n3. Delivery by Distributor: A dedicated distributor delivers your mineral water straight to your door.`;
        }

        cards.push({
          type: 'help',
          title: isCeb ? 'Unsaon Paggamit sa BlueTap' : 'How BlueTap Works',
          steps: [
            { step: '1', title: isCeb ? 'Paghimo og Request' : 'Place Request', detail: isCeb ? 'Pilia ang water station ug gidaghanon sa container.' : 'Select station, product, and delivery address.' },
            { step: '2', title: isCeb ? 'Pag-apruba sa Station' : 'Station Review', detail: isCeb ? 'Mo-review ang branch ug magbutang og oras.' : 'The branch verifies coverage and schedules delivery.' },
            { step: '3', title: isCeb ? 'Kumpirmasyon sa Paghatod' : 'Safe Delivery', detail: isCeb ? 'Ihatod sa distributor ang imong tubig.' : 'Distributor delivers straight to your doorstep.' },
          ],
        });

        actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
          label: isCeb ? 'Mag-order Karon' : 'Start an Order',
        }));
        actions.push(createAction(ASSISTANT_ACTIONS.VIEW_PROFILE, {
          label: isCeb ? 'Tan-awa ang Profile' : 'Manage Address',
        }));
        break;
      }

      case ASSISTANT_INTENTS.TRACK_ORDER:
      case ASSISTANT_INTENTS.ORDER_STATUS: {
        if (hasActive) {
          if (isCeb) {
            message = `Ang imong kasamtangang request (${activeOrder.publicOrderId}) sa ${activeOrder.branchName} kay: "${activeOrder.statusLabel}".${activeOrder.schedule ? ` Gi-iskedyul sa: ${activeOrder.schedule}.` : ''}${activeOrder.isOutsideRadius ? ' Ang imong lokasyon anaa sa gawas sa regular nga service radius, busa gi-review pa kini sa branch.' : ''}`;
          } else {
            message = `Your active water request (${activeOrder.publicOrderId}) at ${activeOrder.branchName} is currently "${activeOrder.statusLabel}".${activeOrder.schedule ? ` Scheduled for: ${activeOrder.schedule}.` : ''}${activeOrder.isOutsideRadius ? ' Your location is outside the normal service radius, so the branch is reviewing coverage.' : ''}`;
          }

          cards.push({
            type: 'order',
            ...activeOrder,
          });

          actions.push(createAction(ASSISTANT_ACTIONS.VIEW_ORDER, {
            label: isCeb ? 'Tan-awa ang Order' : 'View Order Details',
            orderId: activeOrder.id,
          }));

          if (activeOrder.branchId) {
            actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
              label: isCeb ? 'Kontaka ang Station' : 'Contact Station',
              branchId: activeOrder.branchId,
            }));
          }
        } else {
          if (isCeb) {
            message = `Wala kay kasamtangang aktibong request sa tubig karon. Gusto ba ka maghimo og bag-ong order?`;
          } else {
            message = `You do not have any active water requests right now. Would you like to place a new order?`;
          }

          if (safeContext.historyOrders && safeContext.historyOrders.length > 0) {
            const last = safeContext.historyOrders[0];
            if (isCeb) {
              message += ` Ang imong kataposang order (${last.publicOrderId}) kay "${last.statusLabel}".`;
            } else {
              message += ` Your previous request (${last.publicOrderId}) was marked as "${last.statusLabel}".`;
            }
          }

          actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
            label: isCeb ? 'Mag-order og Tubig' : 'Start an Order',
          }));
          actions.push(createAction(ASSISTANT_ACTIONS.OPEN_REQUESTS, {
            label: isCeb ? 'Mga Past Requests' : 'Order History',
          }));
        }
        break;
      }

      case ASSISTANT_INTENTS.DELIVERY_SCHEDULE: {
        if (hasActive && activeOrder.schedule) {
          if (isCeb) {
            message = `Ang imong order (${activeOrder.publicOrderId}) gi-iskedyul nga i-deliver sa: ${activeOrder.schedule} gikan sa ${activeOrder.branchName}.`;
          } else {
            message = `Your order (${activeOrder.publicOrderId}) is scheduled for delivery on ${activeOrder.schedule} from ${activeOrder.branchName}.`;
          }
          cards.push({
            type: 'order',
            ...activeOrder,
          });
          actions.push(createAction(ASSISTANT_ACTIONS.VIEW_ORDER, {
            label: isCeb ? 'Tan-awa ang Iskedyul' : 'View Order',
            orderId: activeOrder.id,
          }));
        } else if (hasActive) {
          if (isCeb) {
            message = `Ang imong order (${activeOrder.publicOrderId}) anaa sa estado nga "${activeOrder.statusLabel}". Inig human sa pag-review ug pag-assign og distributor sa station, makita na diri ang imong eksaktong oras sa delivery.`;
          } else {
            message = `Your order (${activeOrder.publicOrderId}) is currently "${activeOrder.statusLabel}". Once the station finishes reviewing and assigns a distributor, your scheduled delivery window will appear here.`;
          }
          cards.push({
            type: 'order',
            ...activeOrder,
          });
          if (activeOrder.branchId) {
            actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
              label: isCeb ? 'Pangutana sa Station' : 'Contact Station',
              branchId: activeOrder.branchId,
            }));
          }
        } else {
          if (isCeb) {
            message = `Ang mga water station sa BlueTap naghatod sumala sa ilang gitakdang delivery weekdays. Paghimo og request aron makita ang mga iskedyul sa delivery nga available sa imong dapit.`;
          } else {
            message = `BlueTap water stations operate according to designated delivery weekdays. Place a water request to view available delivery schedules for stations servicing your area.`;
          }
          actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
            label: isCeb ? 'Mag-order Karon' : 'Start an Order',
          }));
        }
        break;
      }

      case ASSISTANT_INTENTS.ORDER_APPROVAL_HELP: {
        if (hasActive && activeOrder.isOutsideRadius) {
          if (isCeb) {
            message = `Ang imong delivery address anaa sa gawas sa naandang coverage radius sa ${activeOrder.branchName}. Kinahanglan pa kining kumpirmahon ug aprobahan sa branch sa dili pa makapadala og distributor.`;
          } else {
            message = `Your delivery location is outside ${activeOrder.branchName}'s normal service radius. The branch needs to review and approve the request before assigning a distributor.`;
          }
          cards.push({
            type: 'order',
            ...activeOrder,
          });
          actions.push(createAction(ASSISTANT_ACTIONS.VIEW_ORDER, {
            label: isCeb ? 'Tan-awa ang Request' : 'View Request',
            orderId: activeOrder.id,
          }));
          if (activeOrder.branchId) {
            actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
              label: isCeb ? 'Estoryaha ang Branch' : 'Contact Station',
              branchId: activeOrder.branchId,
            }));
          }
        } else {
          if (isCeb) {
            message = `Kung ang imong delivery location anaa sa gawas sa standard radius sa usa ka station, ang request kinahanglan og pag-apruba sa branch aron masiguro nga luwas ug posible ang paghatod.`;
          } else {
            message = `When your delivery location is outside a station's standard coverage radius, the request requires branch review to confirm delivery feasibility before dispatch.`;
          }
          actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
            label: isCeb ? 'Paghimo og Request' : 'Start Order',
          }));
        }
        break;
      }

      case ASSISTANT_INTENTS.FAILED_DELIVERY_HELP: {
        const failedCandidate = (hasActive && activeOrder.isFailed)
          ? activeOrder
          : (safeContext.historyOrders || []).find((o) => o.isFailed) || null;

        if (failedCandidate) {
          const reason = failedCandidate.safeFailureReason || (isCeb ? 'Naay problema sa paghatod' : 'Delivery issue reported');
          if (isCeb) {
            message = `Wala molampos ang delivery sa imong order (${failedCandidate.publicOrderId}). Rason: ${reason}. Mo-review ang water station niini aron ma-reschedule ang delivery.`;
          } else {
            message = `The delivery attempt for order ${failedCandidate.publicOrderId} was unsuccessful. Reason: ${reason}. The branch is reviewing this request for rescheduling.`;
          }
          cards.push({
            type: 'order',
            ...failedCandidate,
          });
          if (failedCandidate.branchId) {
            actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
              label: isCeb ? 'Kontaka ang Station' : 'Contact Station',
              branchId: failedCandidate.branchId,
            }));
          }
          actions.push(createAction(ASSISTANT_ACTIONS.VIEW_ORDER, {
            label: isCeb ? 'Tan-awa ang Detalye' : 'View Order',
            orderId: failedCandidate.id,
          }));
        } else {
          if (isCeb) {
            message = `Wala kay rekord sa pakyas nga delivery karon. Kung naay problema ang distributor (sama sa walay motubag o dili masudlan ang dalan), i-record kini ug tabangan ka sa station sa pag-reschedule.`;
          } else {
            message = `You do not have any failed deliveries on record. If an issue occurs during delivery (such as no recipient response or inaccessible roads), the distributor records the reason and the branch coordinates a reschedule.`;
          }
          actions.push(createAction(ASSISTANT_ACTIONS.OPEN_REQUESTS, {
            label: isCeb ? 'Tan-awa ang Requests' : 'View Requests',
          }));
        }
        break;
      }

      case ASSISTANT_INTENTS.CANCELLED_ORDER_HELP: {
        const cancelledCandidate = (safeContext.historyOrders || []).find((o) => o.isCancelled) || null;
        if (cancelledCandidate) {
          if (isCeb) {
            message = `Ang imong request (${cancelledCandidate.publicOrderId}) gikansela. Mahimo kang maghimo og bag-ong request sa laing water station bisan unsang orasa.`;
          } else {
            message = `Your request (${cancelledCandidate.publicOrderId}) was cancelled. You can review your past requests or place a new request to another station at any time.`;
          }
        } else {
          if (isCeb) {
            message = `Ang mga request mahimong kanselahon sa dili pa ihatod sa distributor, o balibaran sa branch kung gawas sa coverage. Mahimo kang mag-order og usab.`;
          } else {
            message = `Orders can be cancelled prior to dispatch, or declined by a station if outside service area. You can place a new request to an available station.`;
          }
        }
        actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
          label: isCeb ? 'Bag-ong Order' : 'New Order',
        }));
        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_REQUESTS, {
          label: isCeb ? 'Order History' : 'Order History',
        }));
        break;
      }

      case ASSISTANT_INTENTS.FIND_PROVIDER: {
        const branches = safeContext.availableBranches || [];
        if (branches.length > 0) {
          if (isCeb) {
            message = `Mao kini ang mga aktibong water station sa BlueTap nga nagserbisyo sa imong dapit:`;
          } else {
            message = `Here are active BlueTap water stations available in your area:`;
          }
          branches.slice(0, 3).forEach((b) => {
            cards.push({
              type: 'provider',
              ...b,
            });
          });
        } else {
          if (isCeb) {
            message = `Wala pa karoy aktibong water station sa imong dapit. Palihog susiha pag-usab unya.`;
          } else {
            message = `There are currently no active water stations found for your location. Please check back later.`;
          }
        }
        actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
          label: isCeb ? 'Mag-order' : 'Start an Order',
        }));
        actions.push(createAction(ASSISTANT_ACTIONS.MANAGE_DELIVERY_LOCATION, {
          label: isCeb ? 'Usba ang Address' : 'Change Address',
        }));
        break;
      }

      case ASSISTANT_INTENTS.DELIVERY_LOCATION_HELP: {
        if (isCeb) {
          message = `Aron mag-usab sa imong delivery location:\n\n1. Adto sa Profile tab aron i-update ang imong default address.\n2. Inig himo nimo og bag-ong request, mahimo usab nimo i-adjust ang imong pin sa mapa aron ensakto ang kwenta sa distansya sa pinakaduol nga water station.`;
        } else {
          message = `To manage your delivery location:\n\n1. Visit your Profile tab to set or edit your default delivery address.\n2. When placing a request, you can also adjust your pinned delivery location on the map to ensure accurate distance and coverage calculation.`;
        }
        actions.push(createAction(ASSISTANT_ACTIONS.MANAGE_DELIVERY_LOCATION, {
          label: isCeb ? 'Adto sa Profile' : 'Update Profile Location',
        }));
        actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
          label: isCeb ? 'Mag-order Karon' : 'Place Order',
        }));
        break;
      }

      case ASSISTANT_INTENTS.PRODUCT_HELP:
      case ASSISTANT_INTENTS.CONTAINER_HELP: {
        const products = Array.isArray(safeContext.products) ? safeContext.products : [];
        const hasCatalogProducts = products.length > 0;

        if (hasCatalogProducts) {
          const productList = products
            .slice(0, 5)
            .map((p) => {
              const details = [p.containerType, p.size].filter(Boolean).join(' · ');
              const priceTag = p.price !== null ? ` — ₱${Number(p.price).toFixed(2)}` : '';
              return `• ${p.name || p.product_name}${details ? ` (${details})` : ''}${priceTag}`;
            })
            .join('\n');

          if (isCeb) {
            message = `Ang mga produkto ug klase sa sudlanan nga gitanyag sa mga branch sa BlueTap:\n\n${productList}\n\nKapilian sa sudlanan inig order:\n• New Container (pagpalit og bag-ong sudlanan)\n• Exchange (pag-ilis sa imong haw-ang nga sudlanan)\n\nPilia ang imong gusto nga sudlanan inig himo nimo sa request.`;
          } else {
            message = `Active products and container offerings from BlueTap providers:\n\n${productList}\n\nAvailable container options when ordering:\n• New Container (purchase a new container with water)\n• Exchange (swap an existing empty container)\n\nYou can select your preferred container option on the order screen.`;
          }
        } else {
          // Authoritative container options from requestform.jsx: const containers = ['New Container', 'Exchange']
          if (isCeb) {
            message = `Ang mga water station sa BlueTap nagtanyag og mineral water pinaagi sa duha ka kapilian sa sudlanan:\n\n• New Container (pagpalit og bag-ong sudlanan)\n• Exchange (pag-ilis sa imong haw-ang nga sudlanan)\n\nAng espesipikong mga produkto, gidak-on sa container, ug presyo nagdepende sa matag water station. Makita nimo ang tanang available nga produkto inig pili nimo og branch sa Request screen.`;
          } else {
            message = `BlueTap water stations support two container options when ordering:\n\n• New Container (purchase a new container with water)\n• Exchange (swap your existing empty container)\n\nSpecific container types, sizes, and pricing depend on the selected water station's catalog. You can review available products and select your container option on the Request screen.`;
          }
        }

        actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
          label: isCeb ? 'Tan-awa sa Request' : 'Start Order',
        }));
        break;
      }

      case ASSISTANT_INTENTS.PAYMENT_HELP: {
        // Authoritative sources:
        // 1. backend/requester/orderingHandler.js:254-255 (buildTrustedOrder sets paymentMethod: 'cash_on_delivery')
        // 2. components/RequestDetailsModal.jsx:25 ({ label: 'Payment Method', value: 'Cash on Delivery' })
        // 3. app/requester/r_request.jsx:80 (paymentMethod: request.payment_method || 'cash_on_delivery')
        if (isCeb) {
          message = `Ang BlueTap kasamtangang nagsuporta sa Cash on Delivery (COD). Diretso nimong bayran ang distributor sa paghatod sa mineral water sa imong pultahan.`;
        } else {
          message = `BlueTap currently supports Cash on Delivery (COD). You settle payment directly with the delivery distributor upon receipt of your mineral water.`;
        }
        actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
          label: isCeb ? 'Mag-order og Tubig' : 'Start an Order',
        }));
        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_REQUESTS, {
          label: isCeb ? 'Tan-awa ang Requests' : 'View Requests',
        }));
        break;
      }

      case ASSISTANT_INTENTS.VIEW_NOTIFICATIONS: {
        const notifs = safeContext.recentNotifications || [];
        if (notifs.length > 0) {
          if (isCeb) {
            message = `Mao kini ang imong pinakabag-ong mga notipikasyon sa BlueTap:`;
          } else {
            message = `Here are your recent BlueTap notifications:`;
          }
          notifs.slice(0, 3).forEach((n) => {
            cards.push({
              type: 'notification',
              ...n,
            });
          });
        } else {
          if (isCeb) {
            message = `Wala kay bag-ong notipikasyon karon. Klaro ug updated ang imong account!`;
          } else {
            message = `You have no recent notifications. Your account is completely up to date!`;
          }
        }
        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_NOTIFICATIONS, {
          label: isCeb ? 'Tanan Notipikasyon' : 'Open Notifications',
        }));
        break;
      }

      case ASSISTANT_INTENTS.EXPLAIN_ORDERING_RESTRICTION: {
        const restrictions = safeContext.restrictions?.ordering || [];
        if (restrictions.length > 0) {
          const item = restrictions[0];
          const isBranch = Boolean(item.branchName);
          if (isCeb) {
            message = `Ang imong katungod sa pag-order kasamtangang na-restrikto ${isBranch ? `sa ${item.branchName} lamang` : 'sa tibuok BlueTap'} tungod sa safety review (${item.category}).${item.endsAt ? ` Aktibo kini hangtod ${item.endsAt}.` : ''}${isBranch ? ' Mahimo gihapon kang mag-order sa ubang available nga water station.' : ' Ang tanang pag-order temporaryong gipahunong hangtod mapupos kini.'}`;
          } else {
            message = `Your ordering access is currently restricted ${isBranch ? `specifically at ${item.branchName}` : 'platform-wide'} due to an account safety review (${item.category}).${item.endsAt ? ` Active until ${item.endsAt}.` : ''}${isBranch ? ' You can still place orders with other active water stations.' : ' All ordering is temporarily paused until this restriction expires.'}`;
          }
          cards.push({
            type: 'restriction',
            ...item,
          });
          if (item.branchId) {
            actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
              label: isCeb ? 'Kontaka ang Station' : 'Contact Station',
              branchId: item.branchId,
            }));
          }
        } else {
          if (isCeb) {
            message = `Ang imong kahimtang sa pag-order hingpit nga aktibo ug walay restriksyon! Mahimo kang mag-order og tubig bisan kanus-a.`;
          } else {
            message = `Your ordering status is completely active and clear! You have no restrictions on placing new water requests.`;
          }
          actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
            label: isCeb ? 'Mag-order Karon' : 'Start an Order',
          }));
        }
        break;
      }

      case ASSISTANT_INTENTS.EXPLAIN_CHAT_RESTRICTION: {
        const restrictions = safeContext.restrictions?.chat || [];
        if (restrictions.length > 0) {
          const item = restrictions[0];
          if (isCeb) {
            message = `Ang imong katungod sa pag-chat temporaryong na-restrikto${item.endsAt ? ` hangtod ${item.endsAt}` : ''} subay sa conduct notice (${item.category}). Ang impormasyon sa nag-report ug private moderator notes dili ipadayag.`;
          } else {
            message = `Your messaging access is temporarily restricted${item.endsAt ? ` until ${item.endsAt}` : ''} following a conduct review (${item.category}). Reporter identities and private moderator notes are not disclosed.`;
          }
          cards.push({
            type: 'restriction',
            ...item,
          });
        } else {
          if (isCeb) {
            message = `Wala kay restriksyon sa chat. Mahimo kang makig-istorya sa station para sa mga aktibong order ug inquiries.`;
          } else {
            message = `You have no messaging restrictions. Chat is fully available for active orders and authorized station inquiries.`;
          }
        }
        break;
      }

      case ASSISTANT_INTENTS.CONTACT_STATION: {
        const branchName = activeOrder?.branchName || safeContext.availableBranches?.[0]?.name || 'BlueTap Station';
        const branchId = activeOrder?.branchId || safeContext.availableBranches?.[0]?.id || '';

        if (isCeb) {
          message = `Mahimo nimong kontakon ang imong water station pinaagi sa BlueTap Station Inquiry. Pislita ang buton sa ubos aron makig-istorya sa ${branchName}.`;
        } else {
          message = `You can contact your water station directly using BlueTap Station Inquiry. Tap below to start an operational conversation with ${branchName}.`;
        }

        actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
          label: isCeb ? `Kontaka ang ${branchName}` : `Contact ${branchName}`,
          branchId,
        }));
        break;
      }

      case ASSISTANT_INTENTS.GENERAL_HELP: {
        if (isCeb) {
          message = `Andam ko motabang nimo sa BlueTap! Mahimo kang mangutana bahin sa:\n\n• Pagsubay sa imong request sa tubig\n• Pagsusi sa iskedyul sa delivery\n• Mga problema sa paghatod\n• Pagpasabot sa outside-radius approvals\n• Pag-ilis sa delivery address\n• Pagpangita og water station duol nimo\n• Pagsusi sa notipikasyon ug restriksyon sa account\n• Pagkontak sa imong water station`;
        } else {
          message = `I'm here to help you navigate BlueTap! You can ask me to:\n\n• Track your current water request\n• Check delivery schedules\n• Help with delivery problems\n• Explain outside-radius approvals\n• Update your delivery address\n• Find water stations near you\n• Review notifications & account restrictions\n• Contact your water station`;
        }

        if (hasActive) {
          actions.push(createAction(ASSISTANT_ACTIONS.VIEW_ORDER, {
            label: isCeb ? 'Subaya Akong Order' : 'Track My Order',
            orderId: activeOrder.id,
          }));
        } else {
          actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
            label: isCeb ? 'Mag-order og Tubig' : 'Start an Order',
          }));
        }
        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_REQUESTS, {
          label: isCeb ? 'Tan-awa ang Requests' : 'View Requests',
        }));
        break;
      }

      case ASSISTANT_INTENTS.UNKNOWN:
      default: {
        if (isCeb) {
          message = `Wala ko makasiguro kung unsa nga bahin sa BlueTap ang imong gipasabot. Makatabang ko bahin sa imong order, iskedyul sa delivery, provider, notipikasyon, restriksyon, o water station.`;
        } else {
          message = `I'm not sure which BlueTap issue you mean. I can help with your order, delivery schedule, provider, notifications, restrictions, or station.`;
        }

        if (hasActive) {
          actions.push(createAction(ASSISTANT_ACTIONS.VIEW_ORDER, {
            label: isCeb ? 'Subaya ang Order' : 'Track My Order',
            orderId: activeOrder.id,
          }));
        } else {
          actions.push(createAction(ASSISTANT_ACTIONS.START_ORDER, {
            label: isCeb ? 'Mag-order og Tubig' : 'Start an Order',
          }));
        }
        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_REQUESTS, {
          label: isCeb ? 'Tan-awa ang Requests' : 'View Requests',
        }));
        break;
      }
    }

    return {
      message,
      intent,
      language: isCeb ? 'ceb' : 'en',
      cards,
      actions,
    };
}

export function handleDistributorQuery({ intent, isCeb, safeContext = {}, userInput = '', history = [] }) {
  const distributorName = safeContext.distributor?.firstName || 'Distributor';
  const assignment = safeContext.currentAssignment || null;
  const hasAssignment = Boolean(assignment);
  const isFailed = Boolean(assignment && assignment.isFailed);

  let message = '';
  const cards = [];
  const actions = [];

  switch (intent) {
    case ASSISTANT_INTENTS.CURRENT_DELIVERY:
    case ASSISTANT_INTENTS.DELIVERY_STATUS:
    case ASSISTANT_INTENTS.DELIVERY_DETAILS: {
      if (hasAssignment) {
        if (isCeb) {
          message = `Imong kasamtangang assignment (${assignment.publicOrderId}):\n• Customer: ${assignment.requesterName}\n• Status: ${assignment.statusLabel}\n• Iskedyul: ${assignment.schedule || 'Pending schedule'}\n• Mga Item: ${assignment.productSummary}\n• Station: ${assignment.branchName}`;
          if (assignment.safeAddressLabel) {
            message += `\n• Lugar: ${assignment.safeAddressLabel}`;
          }
          if (isFailed) {
            message += `\n\n⚠️ Pahibalo: Napakyas kini nga delivery (${assignment.safeFailureReason || 'Issue reported'}).`;
          }
        } else {
          message = `Here is your current assigned delivery (${assignment.publicOrderId}):\n• Customer: ${assignment.requesterName}\n• Status: ${assignment.statusLabel}\n• Schedule: ${assignment.schedule || 'Pending schedule'}\n• Items: ${assignment.productSummary}\n• Station: ${assignment.branchName}`;
          if (assignment.safeAddressLabel) {
            message += `\n• Area: ${assignment.safeAddressLabel}`;
          }
          if (isFailed) {
            message += `\n\n⚠️ Note: This delivery was marked unsuccessful (${assignment.safeFailureReason || 'Issue reported'}).`;
          }
        }

        cards.push({
          type: 'delivery',
          ...assignment,
        });

        actions.push(createAction(ASSISTANT_ACTIONS.VIEW_DELIVERY, {
          label: isCeb ? 'Tan-awa ang Detalye' : 'View Delivery Details',
          orderId: assignment.id,
        }));

        if (assignment.chatAllowed) {
          actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_REQUESTER, {
            label: isCeb ? 'Mensahe sa Requester' : 'Contact Requester',
            orderId: assignment.id,
          }));
        }

        actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
          label: isCeb ? 'Kontaka ang Station' : 'Contact Station',
          branchId: assignment.branchId,
          targetRole: 'distributor',
        }));
      } else {
        if (isCeb) {
          message = `Wala kay aktibong gi-assign nga delivery karon. Susiha ang imong iskedyul o bag-ong mga request aron makasugod.`;
        } else {
          message = `You don't have an active delivery assignment right now. You can check your schedule or incoming requests.`;
        }

        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_SCHEDULE, {
          label: isCeb ? 'Tan-awa ang Iskedyul' : 'View Schedule',
          targetRole: 'distributor',
        }));
        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_REQUESTS, {
          label: isCeb ? 'Susiha ang Requests' : 'Check Requests',
          targetRole: 'distributor',
        }));
        actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
          label: isCeb ? 'Kontaka ang Station' : 'Contact Station',
          branchId: safeContext.distributor?.branchId,
          targetRole: 'distributor',
        }));
      }
      break;
    }

    case ASSISTANT_INTENTS.TODAY_SCHEDULE: {
      const schedule = safeContext.todaySchedule || [];
      if (schedule.length > 0) {
        if (isCeb) {
          message = `Aduna kay ${schedule.length} ka delivery nga naka-iskedyul para karong adlawa:`;
          for (const ord of schedule) {
            message += `\n• ${ord.publicOrderId} — ${ord.requesterName} (${ord.schedule || 'Karon'})`;
          }
        } else {
          message = `You have ${schedule.length} delivery assignment(s) scheduled for today:`;
          for (const ord of schedule) {
            message += `\n• ${ord.publicOrderId} — ${ord.requesterName} (${ord.schedule || 'Today'})`;
          }
        }

        for (const ord of schedule.slice(0, 3)) {
          cards.push({
            type: 'delivery',
            ...ord,
          });
        }

        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_SCHEDULE, {
          label: isCeb ? 'Bukas ang Iskedyul' : "Open Today's Schedule",
          targetRole: 'distributor',
        }));
      } else {
        if (isCeb) {
          message = `Wala kay naka-iskedyul nga delivery para karong adlawa.`;
        } else {
          message = `You don't have a scheduled delivery for today.`;
        }

        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_SCHEDULE, {
          label: isCeb ? 'Tan-awa ang Iskedyul' : 'View Schedule',
          targetRole: 'distributor',
        }));
        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_REQUESTS, {
          label: isCeb ? 'Susiha ang Requests' : 'Check Requests',
          targetRole: 'distributor',
        }));
      }
      break;
    }

    case ASSISTANT_INTENTS.NEXT_DELIVERY: {
      const nextOrd = safeContext.nextDelivery || null;
      if (nextOrd) {
        if (isCeb) {
          message = `Ang imong sunod nga delivery mao ang ${nextOrd.publicOrderId}:\n• Customer: ${nextOrd.requesterName}\n• Iskedyul: ${nextOrd.schedule || 'Umaabot'}\n• Status: ${nextOrd.statusLabel}`;
          if (nextOrd.safeAddressLabel) {
            message += `\n• Lugar: ${nextOrd.safeAddressLabel}`;
          }
        } else {
          message = `Your next upcoming delivery is ${nextOrd.publicOrderId}:\n• Customer: ${nextOrd.requesterName}\n• Schedule: ${nextOrd.schedule || 'Upcoming'}\n• Status: ${nextOrd.statusLabel}`;
          if (nextOrd.safeAddressLabel) {
            message += `\n• Area: ${nextOrd.safeAddressLabel}`;
          }
        }

        cards.push({
          type: 'delivery',
          ...nextOrd,
        });

        actions.push(createAction(ASSISTANT_ACTIONS.VIEW_DELIVERY, {
          label: isCeb ? 'Tan-awa ang Delivery' : 'View Delivery',
          orderId: nextOrd.id,
        }));
        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_SCHEDULE, {
          label: isCeb ? 'Tibuok Iskedyul' : 'Full Schedule',
          targetRole: 'distributor',
        }));
      } else {
        if (isCeb) {
          message = `Wala kay umaabot nga delivery nga naka-iskedyul karon.`;
        } else {
          message = `You don't have any upcoming deliveries scheduled right now.`;
        }

        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_REQUESTS, {
          label: isCeb ? 'Susiha ang Requests' : 'Check Requests',
          targetRole: 'distributor',
        }));
      }
      break;
    }

    case ASSISTANT_INTENTS.DELIVERY_LOCATION_HELP: {
      if (isCeb) {
        message = `Ang direksyon ug detalye sa lokasyon sa customer makita sa delivery details screen kon aktibo na ang imong assignment. Pindota sa ubos aron luwas nga makita ang mapa ug mga pahinumdom.`;
      } else {
        message = `Customer delivery directions and location details are available in your delivery details screen once an assignment is active. Tap below to view your current route and address notes safely.`;
      }

      if (hasAssignment) {
        cards.push({
          type: 'delivery',
          ...assignment,
        });
        actions.push(createAction(ASSISTANT_ACTIONS.VIEW_DELIVERY, {
          label: isCeb ? 'Bukas ang Lokasyon' : 'Open Delivery Map',
          orderId: assignment.id,
        }));
      } else {
        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_SCHEDULE, {
          label: isCeb ? 'Tan-awa ang Iskedyul' : 'View Schedule',
          targetRole: 'distributor',
        }));
      }
      break;
    }

    case ASSISTANT_INTENTS.CONTACT_REQUESTER: {
      if (hasAssignment) {
        if (assignment.chatAllowed) {
          if (isCeb) {
            message = `Mahimo kang mo-chat kang ${assignment.requesterName} diretso para sa koordinasyon sa delivery sa order ${assignment.publicOrderId}.`;
          } else {
            message = `You can message ${assignment.requesterName} directly for delivery coordination on order ${assignment.publicOrderId}.`;
          }

          actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_REQUESTER, {
            label: isCeb ? 'Mensahe sa Requester' : 'Message Requester',
            orderId: assignment.id,
          }));
        } else {
          message = assignment.chatExplanation || (isCeb
            ? 'Dili available ang pag-chat sa customer para niining order.'
            : 'Direct messaging with the requester is not available for this delivery.');

          actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
            label: isCeb ? 'Kontaka ang Station' : 'Contact Station',
            branchId: assignment.branchId,
            targetRole: 'distributor',
          }));
        }
      } else {
        if (isCeb) {
          message = `Wala kay aktibong delivery assignment karon nga puwede makig-chat sa requester.`;
        } else {
          message = `You don't have an active delivery assignment to contact a requester for.`;
        }

        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_SCHEDULE, {
          label: isCeb ? 'Tan-awa ang Iskedyul' : 'View Schedule',
          targetRole: 'distributor',
        }));
      }
      break;
    }

    case ASSISTANT_INTENTS.CHAT_AVAILABILITY: {
      if (isCeb) {
        message = `Mga patakaran sa mensahe sa BlueTap delivery:\n\n• Aktibong Order: Pwede ka makig-chat sa requester para sa koordinasyon sa paghatod.\n• Nahuman (Delivered): Masirado dayon ang chat inig human sa delivery.\n• Napakyas (Failed Delivery): Adunay 1 ka oras nga grace period aron makig-istorya sa customer. Pagkahuman sa 1 ka oras, masirado ang chat.\n• Pagbalhin: Ang katungod sa chat mabalhin sa bag-ong distributor.`;
        if (hasAssignment) {
          message += `\n\nKaron sa ${assignment.publicOrderId}: ${assignment.chatExplanation}`;
        }
      } else {
        message = `BlueTap delivery messaging rules:\n\n• Active Assigned Orders: Direct messaging with the requester is available for delivery coordination.\n• Delivered: Messaging ends immediately once delivery is marked completed.\n• Failed Delivery: A 1-hour grace window is provided to coordinate retry or return. After 1 hour, chat closes.\n• Reassignment: Messaging access transfers to the new distributor.`;
        if (hasAssignment) {
          message += `\n\nFor order ${assignment.publicOrderId}: ${assignment.chatExplanation}`;
        }
      }

      if (hasAssignment && assignment.chatAllowed) {
        actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_REQUESTER, {
          label: isCeb ? 'Mensahe sa Requester' : 'Message Requester',
          orderId: assignment.id,
        }));
      }
      actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
        label: isCeb ? 'Kontaka ang Station' : 'Contact Station',
        branchId: safeContext.distributor?.branchId,
        targetRole: 'distributor',
      }));
      break;
    }

    case ASSISTANT_INTENTS.CONTACT_STATION: {
      const branchId = safeContext.distributor?.branchId || '';
      const stationName = safeContext.distributor?.branchName || 'your station';
      if (!branchId) {
        message = isCeb
          ? 'Wala pay naka-assign nga water station sa imong distributor account. Palihug pakigkita sa imong administrator.'
          : 'No water station is currently assigned to your distributor account. Please contact your administrator.';
        break;
      }
      if (isCeb) {
        message = `Mahimo kang makig-istorya sa imong water station manager sa ${stationName} para sa suporta sa operasyon, stock, o mga isyu sa branch.`;
      } else {
        message = `You can contact your water station manager at ${stationName} for operational support, stock availability, or branch coordination.`;
      }

      actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
        label: isCeb ? 'Kontaka ang Station' : 'Contact Station',
        branchId,
        targetRole: 'distributor',
      }));
      break;
    }

    case ASSISTANT_INTENTS.FAILED_DELIVERY_HELP: {
      if (isCeb) {
        message = `Kung napakyas ang delivery (pananglit wala ang customer, sayop nga address, o nibalibad):\n\n1. I-rekord ang delivery attempt sa imong schedule tab ug pilia ang saktong rason sa kapakyasan.\n2. Aduna kay 1 ka oras (1-hour grace window) nga follow-up messaging sa requester aron magkasinabot kung gikinahanglan.\n3. Kontaka ang imong water station manager aron ma-iskedyul pag-usab o iuli ang sudlanan sa inventory.`;
      } else {
        message = `If a delivery attempt fails (e.g. customer unavailable, wrong address, refused):\n\n1. Record the attempt in your schedule tab and select the specific failure reason.\n2. You have a 1-hour grace window (follow-up messaging) with the requester to arrange resolution if needed.\n3. Contact your water station manager to reschedule delivery or return containers to inventory.`;
      }

      if (hasAssignment && isFailed) {
        cards.push({
          type: 'delivery',
          ...assignment,
        });

        actions.push(createAction(ASSISTANT_ACTIONS.VIEW_DELIVERY, {
          label: isCeb ? 'Idumala ang Failed Delivery' : 'Manage Failed Delivery',
          orderId: assignment.id,
        }));

        if (assignment.chatGraceActive) {
          actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_REQUESTER, {
            label: isCeb ? 'Mensahe sa Requester' : 'Message Requester',
            orderId: assignment.id,
          }));
        }
      }

      actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
        label: isCeb ? 'Kontaka ang Station' : 'Contact Station',
        branchId: safeContext.distributor?.branchId,
        targetRole: 'distributor',
      }));
      break;
    }

    case ASSISTANT_INTENTS.VIEW_NOTIFICATIONS: {
      const notifs = safeContext.notifications || [];
      if (notifs.length > 0) {
        if (isCeb) {
          message = `Mao kini ang imong mga bag-ong pahibalo sa distributor:`;
        } else {
          message = `Here are your recent distributor notifications:`;
        }

        cards.push({
          type: 'notifications',
          notifications: notifs,
        });

        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_NOTIFICATIONS, {
          label: isCeb ? 'Tan-awa ang Tanan' : 'View All Notifications',
          targetRole: 'distributor',
        }));
      } else {
        if (isCeb) {
          message = `Wala kay bag-ong mga pahibalo sa pagkakaron.`;
        } else {
          message = `You have no new notifications right now.`;
        }

        actions.push(createAction(ASSISTANT_ACTIONS.OPEN_NOTIFICATIONS, {
          label: isCeb ? 'Bukas ang Notifications' : 'Open Notifications',
          targetRole: 'distributor',
        }));
      }
      break;
    }

    case ASSISTANT_INTENTS.DELIVERY_HISTORY: {
      const historyItems = safeContext.recentHistory || [];
      if (historyItems.length > 0) {
        if (isCeb) {
          message = `Nahuman nimo ang ${historyItems.length} ka delivery bag-ohay lang. Pindota sa ubos aron makita ang tibuok kaagi sa imong delivery.`;
        } else {
          message = `You have completed ${historyItems.length} delivery(s) recently. Tap below to view your full delivery history.`;
        }
      } else {
        if (isCeb) {
          message = `Wala pa kay nahuman nga delivery karon. Susiha ang imong iskedyul aron makasugod.`;
        } else {
          message = `You haven't completed any deliveries yet today. Check your schedule to start deliveries.`;
        }
      }

      actions.push(createAction(ASSISTANT_ACTIONS.OPEN_HISTORY, {
        label: isCeb ? 'Kaagi sa Delivery' : 'Open Delivery History',
        targetRole: 'distributor',
      }));
      break;
    }

    case ASSISTANT_INTENTS.HOW_DISTRIBUTOR_WORKS: {
      if (isCeb) {
        message = `Giunsa paglihok sa BlueTap delivery para sa mga Distributor sa 3 ka lakang:\n\n1. Review ug Dawata: Susiha ang mga request gikan sa imong station ug dawata ang imong assignments.\n2. Iskedyul ug Ihatod: Sugdi ang delivery sa imong schedule tab ug adtoa ang address sa customer.\n3. Kumpletoha o I-report: Ihatod ang mga sudlanan ug i-mark nga delivered, o i-rekord ang rason kung napakyas.`;
      } else {
        message = `How BlueTap delivery works for Distributors in 3 easy steps:\n\n1. Review & Accept: Check incoming water requests from your station and accept delivery assignments.\n2. Schedule & Deliver: Start delivery in your schedule tab and navigate to the customer address.\n3. Complete or Report: Hand over the water containers and mark delivered, or record a failure reason if unavailable.`;
      }

      cards.push({
        type: 'help',
        title: isCeb ? 'Giunsa Paghatod sa Distributor' : 'How Distributor Delivery Works',
        steps: [
          { step: '1', title: isCeb ? 'Pagdawat' : 'Accept Assignment', detail: isCeb ? 'Dawata ang request sa imong requests tab.' : 'Review and accept requests in your requests tab.' },
          { step: '2', title: isCeb ? 'Paghatod' : 'Deliver to Customer', detail: isCeb ? 'Sugdi ang delivery ug sunda ang lokasyon.' : 'Start delivery and follow the customer address.' },
          { step: '3', title: isCeb ? 'Pagkumpirma' : 'Complete Delivery', detail: isCeb ? 'I-mark nga delivered o i-report kung napakyas.' : 'Mark delivered or report failure reason with grace period.' },
        ],
      });

      actions.push(createAction(ASSISTANT_ACTIONS.OPEN_REQUESTS, {
        label: isCeb ? 'Susiha ang Requests' : 'Check Requests',
        targetRole: 'distributor',
      }));
      actions.push(createAction(ASSISTANT_ACTIONS.OPEN_SCHEDULE, {
        label: isCeb ? 'Tan-awa ang Iskedyul' : 'View Schedule',
        targetRole: 'distributor',
      }));
      break;
    }

    case ASSISTANT_INTENTS.GREETING: {
      if (isCeb) {
        message = `Maayong adlaw, ${distributorName}! 👋 Ako ang imong BlueTap Assistant. Makatabang ko sa imong mga gi-assign nga delivery, pagsusi sa iskedyul karon, mga patakaran sa chat, o pagkonektar sa imong station manager.`;
      } else {
        message = `Hello, ${distributorName}! 👋 I'm your BlueTap Assistant. I can help track your assigned deliveries, check today's schedule, explain customer messaging rules, or connect with your station manager.`;
      }

      if (hasAssignment) {
        cards.push({
          type: 'delivery',
          ...assignment,
        });

        actions.push(createAction(ASSISTANT_ACTIONS.VIEW_DELIVERY, {
          label: isCeb ? 'Tan-awa ang Delivery' : 'View Delivery',
          orderId: assignment.id,
        }));
      }

      actions.push(createAction(ASSISTANT_ACTIONS.OPEN_SCHEDULE, {
        label: isCeb ? 'Tan-awa ang Iskedyul' : 'View Schedule',
        targetRole: 'distributor',
      }));
      actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
        label: isCeb ? 'Kontaka ang Station' : 'Contact Station',
        branchId: safeContext.distributor?.branchId,
        targetRole: 'distributor',
      }));
      break;
    }

    case ASSISTANT_INTENTS.GENERAL_HELP:
    case ASSISTANT_INTENTS.UNKNOWN:
    default: {
      if (isCeb) {
        message = `Makatabang ko sa imong mga gi-assign nga delivery, iskedyul, mga problema sa delivery, pahibalo, pag-chat sa customer, ug suporta gikan sa station. Unsay akong matabang nimo karon?`;
      } else {
        message = `I can help with your assigned deliveries, schedule, delivery issues, notifications, requester communication, and station support. How can I assist you right now?`;
      }

      actions.push(createAction(ASSISTANT_ACTIONS.OPEN_SCHEDULE, {
        label: isCeb ? 'Tan-awa ang Iskedyul' : 'View Schedule',
        targetRole: 'distributor',
      }));
      actions.push(createAction(ASSISTANT_ACTIONS.OPEN_REQUESTS, {
        label: isCeb ? 'Susiha ang Requests' : 'Check Requests',
        targetRole: 'distributor',
      }));
      actions.push(createAction(ASSISTANT_ACTIONS.CONTACT_STATION, {
        label: isCeb ? 'Kontaka ang Station' : 'Contact Station',
        branchId: safeContext.distributor?.branchId,
        targetRole: 'distributor',
      }));
      break;
    }
  }

  return {
    message,
    intent,
    language: isCeb ? 'ceb' : 'en',
    cards,
    actions,
  };
}

export const defaultAssistantEngine = new DeterministicAssistantEngine();
