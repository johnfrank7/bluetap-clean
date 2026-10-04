export const ASSISTANT_INTENTS = Object.freeze({
  GREETING: 'GREETING',
  HOW_BLUETAP_WORKS: 'HOW_BLUETAP_WORKS',
  GENERAL_HELP: 'GENERAL_HELP',
  START_ORDER: 'START_ORDER',
  TRACK_ORDER: 'TRACK_ORDER',
  ORDER_STATUS: 'ORDER_STATUS',
  DELIVERY_SCHEDULE: 'DELIVERY_SCHEDULE',
  ORDER_APPROVAL_HELP: 'ORDER_APPROVAL_HELP',
  FAILED_DELIVERY_HELP: 'FAILED_DELIVERY_HELP',
  CANCELLED_ORDER_HELP: 'CANCELLED_ORDER_HELP',
  FIND_PROVIDER: 'FIND_PROVIDER',
  DELIVERY_LOCATION_HELP: 'DELIVERY_LOCATION_HELP',
  PRODUCT_HELP: 'PRODUCT_HELP',
  CONTAINER_HELP: 'CONTAINER_HELP',
  PAYMENT_HELP: 'PAYMENT_HELP',
  VIEW_NOTIFICATIONS: 'VIEW_NOTIFICATIONS',
  EXPLAIN_ORDERING_RESTRICTION: 'EXPLAIN_ORDERING_RESTRICTION',
  EXPLAIN_CHAT_RESTRICTION: 'EXPLAIN_CHAT_RESTRICTION',
  CONTACT_STATION: 'CONTACT_STATION',
  // Distributor Specific Intents
  CURRENT_DELIVERY: 'CURRENT_DELIVERY',
  TODAY_SCHEDULE: 'TODAY_SCHEDULE',
  NEXT_DELIVERY: 'NEXT_DELIVERY',
  DELIVERY_STATUS: 'DELIVERY_STATUS',
  DELIVERY_DETAILS: 'DELIVERY_DETAILS',
  CONTACT_REQUESTER: 'CONTACT_REQUESTER',
  CHAT_AVAILABILITY: 'CHAT_AVAILABILITY',
  DELIVERY_HISTORY: 'DELIVERY_HISTORY',
  HOW_DISTRIBUTOR_WORKS: 'HOW_DISTRIBUTOR_WORKS',
  UNKNOWN: 'UNKNOWN',
});

export const DISTRIBUTOR_ASSISTANT_INTENTS = Object.freeze({
  CURRENT_DELIVERY: 'CURRENT_DELIVERY',
  TODAY_SCHEDULE: 'TODAY_SCHEDULE',
  NEXT_DELIVERY: 'NEXT_DELIVERY',
  DELIVERY_STATUS: 'DELIVERY_STATUS',
  DELIVERY_DETAILS: 'DELIVERY_DETAILS',
  DELIVERY_LOCATION_HELP: 'DELIVERY_LOCATION_HELP',
  CONTACT_REQUESTER: 'CONTACT_REQUESTER',
  CONTACT_STATION: 'CONTACT_STATION',
  CHAT_AVAILABILITY: 'CHAT_AVAILABILITY',
  FAILED_DELIVERY_HELP: 'FAILED_DELIVERY_HELP',
  VIEW_NOTIFICATIONS: 'VIEW_NOTIFICATIONS',
  DELIVERY_HISTORY: 'DELIVERY_HISTORY',
  HOW_DISTRIBUTOR_WORKS: 'HOW_DISTRIBUTOR_WORKS',
  GENERAL_HELP: 'GENERAL_HELP',
  GREETING: 'GREETING',
  UNKNOWN: 'UNKNOWN',
});

export const CEBUANO_MARKERS = [
  'asa', 'akong', 'akoa', 'kanus-a', 'kanus a', 'nganong', 'ngano',
  'tubig', 'unsaon', 'unsa', 'unsay', 'pila', 'tagpila', 'tabang',
  'tabangi', 'kumusta', 'komusta', 'maayong', 'maayo', 'dili', 'di',
  'duol', 'layo', 'naabot', 'nako', 'nimo', 'imong', 'imo', 'pwede',
  'sudlanan', 'tan-awa', 'tan awa', 'adlaw', 'oras', 'estoryaha',
  'mensahe', 'bahin', 'palit', 'mo-order', 'mo order', 'mag-order',
  'mag order', 'kabalo', 'kaayo', 'man', 'kinsa', 'kani', 'karon',
  'diin', 'ba', 'nahuman', 'wala', 'wa', 'sulod', 'pag-ilis', 'pag ilis'
];

export function normalizeText(text = '') {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[?,.!/\\#;:_()\-+*"'`~]/g, ' ')
    .replace(/\s+/g, ' ');
}

export function detectLanguage(text = '') {
  const norm = normalizeText(text);
  const words = norm.split(/\s+/).filter(Boolean);
  const wordSet = new Set(words);
  for (const marker of CEBUANO_MARKERS) {
    if (marker.includes(' ')) {
      if (norm.includes(marker)) return 'ceb';
    } else {
      if (wordSet.has(marker)) return 'ceb';
    }
  }
  return 'en';
}

export function classifyIntentDetails(text = '') {
  const norm = normalizeText(text);
  if (!norm) {
    return {
      intent: ASSISTANT_INTENTS.UNKNOWN,
      confidence: 'none',
      matchedRule: null,
    };
  }

  // 1. Specific Ordering Restriction Explanations (Evaluated before general ordering)
  if (
    /why (can[\s']*t|cannot|cant) i order/i.test(norm) ||
    /why (am i|is my account) restricted/i.test(norm) ||
    /why is my account restricted/i.test(norm) ||
    /order(ing)? (is )?restricted/i.test(norm) ||
    /order(ing)? (is )?suspended/i.test(norm) ||
    /why dili ko ka order/i.test(norm) ||
    /ngano(ng)? dili ko ka order/i.test(norm) ||
    /ngano(ng)? di ko ka order/i.test(norm) ||
    /ngano(ng)? restricted ko/i.test(norm) ||
    /ngano(ng)? restricted akong (ordering|account)/i.test(norm) ||
    /dili ko ka order/i.test(norm) ||
    /dili maka order/i.test(norm) ||
    /can i still order/i.test(norm) ||
    /how (do i |to )?resolve (this )?restriction/i.test(norm) ||
    /how to resolve/i.test(norm) ||
    /account notice/i.test(norm) ||
    /wala koy katungod mo order/i.test(norm) ||
    /why (can[\s']*t|cannot|cant) i place (an )?order/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.EXPLAIN_ORDERING_RESTRICTION,
      confidence: 'high',
      matchedRule: 'EXPLAIN_ORDERING_RESTRICTION',
    };
  }

  // 2. Specific Chat Restriction Explanations
  if (
    /why (can[\s']*t|cannot|cant) i (chat|message|send)/i.test(norm) ||
    /chat (is )?restricted/i.test(norm) ||
    /chat (is )?disabled/i.test(norm) ||
    /ngano(ng)? dili ko ka (chat|message|text)/i.test(norm) ||
    /ngano(ng)? di ko ka (chat|message)/i.test(norm) ||
    /dili ko ka (chat|message|text)/i.test(norm) ||
    /restricted akong chat/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.EXPLAIN_CHAT_RESTRICTION,
      confidence: 'high',
      matchedRule: 'EXPLAIN_CHAT_RESTRICTION',
    };
  }

  // 3. Contact Station (Evaluated before general station search or chat)
  if (
    /contact (the |a |my )?(water )?(station|branch|manager|provider)/i.test(norm) ||
    /message (the |a |my )?(water )?(station|branch)/i.test(norm) ||
    /talk to (the |a )?(station|branch|manager)/i.test(norm) ||
    /call (the |a )?(station|branch|water station)/i.test(norm) ||
    /reach (the |a )?(station|branch)/i.test(norm) ||
    /how do i (contact|message|call|reach) (the |a |my )?(water )?(station|branch)/i.test(norm) ||
    /pwede (ba )?(ko )?mo (contact|message|chat) sa (water )?(station|branch)/i.test(norm) ||
    /unsaon (nako )?pag (contact|message|tawag|chat) sa (water )?(branch|station)/i.test(norm) ||
    /kontaka ang (water )?(station|branch)/i.test(norm) ||
    /estoryaha ang (water )?(branch|station)/i.test(norm) ||
    /mensahe sa (water )?station/i.test(norm) ||
    /tawagi ang (water )?(station|branch)/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.CONTACT_STATION,
      confidence: 'high',
      matchedRule: 'CONTACT_STATION',
    };
  }

  // 4. Delivery Failure
  if (
    /why (did|was) (my )?delivery fail/i.test(norm) ||
    /delivery (has )?failed/i.test(norm) ||
    /failed delivery/i.test(norm) ||
    /delivery problem/i.test(norm) ||
    /failed (my )?order/i.test(norm) ||
    /ngano(ng)? (na )?fail(ed)? (ang |akong )?delivery/i.test(norm) ||
    /wala na deliver (ang )?tubig/i.test(norm) ||
    /wala nadeliver/i.test(norm) ||
    /problema sa delivery/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.FAILED_DELIVERY_HELP,
      confidence: 'high',
      matchedRule: 'FAILED_DELIVERY_HELP',
    };
  }

  // 5. Cancelled Order / Cancellation Help (Evaluated before general order status)
  if (
    /why (was|is) (my )?order cancel/i.test(norm) ||
    /can i cancel/i.test(norm) ||
    /cancel(led)? (my |the )?(order|request)/i.test(norm) ||
    /cancel(led)? order/i.test(norm) ||
    /order (was )?cancel/i.test(norm) ||
    /pwede.*cancel/i.test(norm) ||
    /ma-?cancel/i.test(norm) ||
    /ngano(ng)? na cancel (akong )?order/i.test(norm) ||
    /gi cancel (akong )?order/i.test(norm) ||
    /na cancel akong order/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.CANCELLED_ORDER_HELP,
      confidence: 'high',
      matchedRule: 'CANCELLED_ORDER_HELP',
    };
  }

  // 6. Outside Radius / Branch Approval Help
  if (
    /outside radius/i.test(norm) ||
    /pending approval/i.test(norm) ||
    /waiting for branch/i.test(norm) ||
    /branch approval/i.test(norm) ||
    /gawas sa radius/i.test(norm) ||
    /naghulat (ug |og )?approval/i.test(norm) ||
    /ngano(ng)? pending pa/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.ORDER_APPROVAL_HELP,
      confidence: 'high',
      matchedRule: 'ORDER_APPROVAL_HELP',
    };
  }

  // 7. Delivery Schedule / Time (Evaluated before general order tracking)
  if (
    /when (will |is )?(my |the )?(water|order) (be )?deliver/i.test(norm) ||
    /when (will |is )?(my |the )?(it|water|order) arrive/i.test(norm) ||
    /when is my delivery scheduled/i.test(norm) ||
    /delivery schedule/i.test(norm) ||
    /delivery time/i.test(norm) ||
    /delivery hours/i.test(norm) ||
    /what are the delivery hours/i.test(norm) ||
    /expected delivery/i.test(norm) ||
    /what time (will it|delivery)/i.test(norm) ||
    /when ma deliver akong (tubig|order)/i.test(norm) ||
    /kanus a ma deliver/i.test(norm) ||
    /kanus a maabot/i.test(norm) ||
    /kanus a moabot/i.test(norm) ||
    /oras sa delivery/i.test(norm) ||
    /adlaw sa delivery/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.DELIVERY_SCHEDULE,
      confidence: 'high',
      matchedRule: 'DELIVERY_SCHEDULE',
    };
  }

  // 8. Payment Help (Evaluated before general orders)
  if (
    /payment option/i.test(norm) ||
    /payment method/i.test(norm) ||
    /what payment/i.test(norm) ||
    /how (to |do i )?pay/i.test(norm) ||
    /cash on delivery/i.test(norm) ||
    /\bcod\b/i.test(norm) ||
    /unsaon pag( )?bayad/i.test(norm) ||
    /pamaagi sa pagbayad/i.test(norm) ||
    /bayaran/i.test(norm) ||
    /mo dawat (ba )?(mog|mo og) cash/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.PAYMENT_HELP,
      confidence: 'high',
      matchedRule: 'PAYMENT_HELP',
    };
  }

  // 9. Track Order / Order Status / Past Orders
  if (
    /where is (my |the |an )?(current )?(order|water|delivery)/i.test(norm) ||
    /where is (current )?(order|delivery)/i.test(norm) ||
    /where can i see (my )?past orders/i.test(norm) ||
    /where (can i |to )?see past orders/i.test(norm) ||
    /show (my )?(past |current )?orders?/i.test(norm) ||
    /order details/i.test(norm) ||
    /track (my |the |an )?(current )?(order|water|delivery)/i.test(norm) ||
    /status of (my |the )?(current )?(order|water|delivery)/i.test(norm) ||
    /order status/i.test(norm) ||
    /delivery status/i.test(norm) ||
    /what is my order status/i.test(norm) ||
    /check (my )?(current )?(order|water|delivery)/i.test(norm) ||
    /asa (na )?(ang )?(akong |ako )?(order|tubig|delivery)/i.test(norm) ||
    /asa (ang )?akong (order|delivery|tubig)/i.test(norm) ||
    /status sa (akong |ako )?(order|delivery)/i.test(norm) ||
    /unsay status/i.test(norm) ||
    /subaya akong order/i.test(norm) ||
    /kumusta akong order/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.TRACK_ORDER,
      confidence: 'high',
      matchedRule: 'TRACK_ORDER',
    };
  }

  // 10. How BlueTap Works (Evaluated before general start order)
  if (
    /how (does )?bluetap work/i.test(norm) ||
    /how (do i |to )?order water on bluetap/i.test(norm) ||
    /what is bluetap/i.test(norm) ||
    /explain bluetap/i.test(norm) ||
    /how to use bluetap/i.test(norm) ||
    /new to bluetap/i.test(norm) ||
    /unsaon pag gamit sa bluetap/i.test(norm) ||
    /unsa ning bluetap/i.test(norm) ||
    /unsaon ni pag trabaho/i.test(norm) ||
    /unsa ang bluetap/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.HOW_BLUETAP_WORKS,
      confidence: 'high',
      matchedRule: 'HOW_BLUETAP_WORKS',
    };
  }

  // 11. Container Types & Sizes
  if (
    /what container/i.test(norm) ||
    /container (type|types|size|sizes)/i.test(norm) ||
    /container types and sizes/i.test(norm) ||
    /slim gallon/i.test(norm) ||
    /round gallon/i.test(norm) ||
    /klase sa sudlanan/i.test(norm) ||
    /gallon/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.CONTAINER_HELP,
      confidence: 'high',
      matchedRule: 'CONTAINER_HELP',
    };
  }

  // 12. Start / Place Order
  if (
    /start (an )?order/i.test(norm) ||
    /order water/i.test(norm) ||
    /place (an )?order/i.test(norm) ||
    /request water/i.test(norm) ||
    /new order/i.test(norm) ||
    /buy water/i.test(norm) ||
    /i want to order/i.test(norm) ||
    /add request/i.test(norm) ||
    /mo order (ko|kog tubig)/i.test(norm) ||
    /mag order (ko|kog tubig)/i.test(norm) ||
    /palit (ko |kog |ug )?tubig/i.test(norm) ||
    /order (ko |kog |ug )?tubig/i.test(norm) ||
    /unsaon pag order/i.test(norm) ||
    /gusto ko mag order/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.START_ORDER,
      confidence: 'high',
      matchedRule: 'START_ORDER',
    };
  }

  // 13. Provider / Branch Finder
  if (
    /find (a )?provider/i.test(norm) ||
    /find (nearby )?(water )?stations/i.test(norm) ||
    /where is the nearest provider/i.test(norm) ||
    /nearest (branch|station|provider)/i.test(norm) ||
    /water station near me/i.test(norm) ||
    /nearby (branch|station|stations)/i.test(norm) ||
    /available (branch|station|provider)/i.test(norm) ||
    /which branch/i.test(norm) ||
    /asa akong nearest provider/i.test(norm) ||
    /asa ang pinakaduol/i.test(norm) ||
    /duol nga (water )?station/i.test(norm) ||
    /mga available nga station/i.test(norm) ||
    /pangita (ug |og )?(water )?station/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.FIND_PROVIDER,
      confidence: 'high',
      matchedRule: 'FIND_PROVIDER',
    };
  }

  // 14. Delivery Location / Address Help
  if (
    /delivery location/i.test(norm) ||
    /change (delivery )?address/i.test(norm) ||
    /update (delivery )?location/i.test(norm) ||
    /update (delivery )?address/i.test(norm) ||
    /wrong address/i.test(norm) ||
    /how to change address/i.test(norm) ||
    /why is branch far/i.test(norm) ||
    /unsaon pag change sa address/i.test(norm) ||
    /unsaon pag change sa delivery location/i.test(norm) ||
    /usba (akong )?address/i.test(norm) ||
    /ngano(ng)? layo ang branch/i.test(norm) ||
    /sayop (akong )?address/i.test(norm) ||
    /pag ilis (ug |og )?address/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.DELIVERY_LOCATION_HELP,
      confidence: 'high',
      matchedRule: 'DELIVERY_LOCATION_HELP',
    };
  }

  // 15. Product & Pricing Help
  if (
    /product price/i.test(norm) ||
    /price of water/i.test(norm) ||
    /how much (is|are) (the )?(water|container)/i.test(norm) ||
    /refill price/i.test(norm) ||
    /tagpila ang tubig/i.test(norm) ||
    /pila ang container/i.test(norm) ||
    /mga produkto/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.PRODUCT_HELP,
      confidence: 'high',
      matchedRule: 'PRODUCT_HELP',
    };
  }

  // 16. Notifications
  if (
    /my notification/i.test(norm) ||
    /recent notification/i.test(norm) ||
    /show notification/i.test(norm) ||
    /check (my )?alert/i.test(norm) ||
    /latest notification/i.test(norm) ||
    /unsay latest notification/i.test(norm) ||
    /akong mga notipikasyon/i.test(norm) ||
    /mga pahibalo/i.test(norm) ||
    /tan awa akong notipikasyon/i.test(norm) ||
    /unsay alert/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.VIEW_NOTIFICATIONS,
      confidence: 'high',
      matchedRule: 'VIEW_NOTIFICATIONS',
    };
  }

  // 16. Greetings
  if (
    /^(hi|hello|hey|good morning|good afternoon|good evening|greetings)\b/i.test(norm) ||
    /^(kumusta|komusta|maayong adlaw|maayong buntag|maayong hapon|maayong gabii|maayong gabi)\b/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.GREETING,
      confidence: 'high',
      matchedRule: 'GREETING',
    };
  }

  // 17. General Help
  if (
    /^help\b/i.test(norm) ||
    /what can you do/i.test(norm) ||
    /unsa imong (ma)?himo/i.test(norm) ||
    /unsa imong matabang/i.test(norm) ||
    /tabang(i)?( ko)?/i.test(norm)
  ) {
    return {
      intent: ASSISTANT_INTENTS.GENERAL_HELP,
      confidence: 'high',
      matchedRule: 'GENERAL_HELP',
    };
  }

  // Ambiguous or unclassified query
  return {
    intent: ASSISTANT_INTENTS.UNKNOWN,
    confidence: 'low',
    matchedRule: null,
  };
}

export function classifyDistributorIntentDetails(text = '') {
  const norm = normalizeText(text);
  if (!norm) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.UNKNOWN,
      confidence: 'none',
      matchedRule: null,
    };
  }

  // 1. Chat Availability Explanations
  if (
    /why (can[\s']*t|cannot|cant) i (message|chat|send|text) (the |to )?(requester|customer)/i.test(norm) ||
    /why is (the )?chat (closed|disabled|unavailable)/i.test(norm) ||
    /pwede pa (ba |ko )?(mo|mag|makig) ?(chat|message|text)/i.test(norm) ||
    /pwede pa ko mo (chat|message)/i.test(norm) ||
    /pwede pa ba mo (chat|message)/i.test(norm) ||
    /ngano(ng)? (closed|sirado) ang chat/i.test(norm) ||
    /ngano(ng)? (dili|di) (na )?ko ka (message|chat|text)/i.test(norm) ||
    /can i still (message|chat) (the )?(requester|customer)/i.test(norm) ||
    /can i still message/i.test(norm) ||
    /chat availability/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.CHAT_AVAILABILITY,
      confidence: 'high',
      matchedRule: 'CHAT_AVAILABILITY',
    };
  }

  // 2. Failed Delivery Help
  if (
    (/what (should|to) (i )?do/i.test(norm) && /(delivery failed|cannot be reached|not available|refused|can't be reached)/i.test(norm)) ||
    /cannot be reached/i.test(norm) ||
    /can[\s']*t be reached/i.test(norm) ||
    /failed delivery/i.test(norm) ||
    /delivery failed/i.test(norm) ||
    /dili ma(-|\s)?contact ang (customer|requester)/i.test(norm) ||
    /unsa buhaton kung (dili|di) ma(-|\s)?contact/i.test(norm) ||
    /wala ang (requester|customer)/i.test(norm) ||
    /wa ang (requester|customer)/i.test(norm) ||
    /no response/i.test(norm) ||
    /recipient refused/i.test(norm) ||
    /customer refused/i.test(norm) ||
    /ngano(ng)? failed (akong|ang) delivery/i.test(norm) ||
    /unsaon kung failed ang delivery/i.test(norm) ||
    /unsaon kung di ma-deliver/i.test(norm) ||
    /wala nadawat ang tubig/i.test(norm) ||
    /wa nadawat ang tubig/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.FAILED_DELIVERY_HELP,
      confidence: 'high',
      matchedRule: 'FAILED_DELIVERY_HELP',
    };
  }

  // 3. Contact Requester Direct Intent
  if (
    /(contact|message|chat|text|call) (the |my )?(requester|customer)/i.test(norm) ||
    /how (do i |to )?(contact|message|chat|call|reach) (the |my )?(requester|customer)/i.test(norm) ||
    /contact (customer|requester)/i.test(norm) ||
    /unsaon pag(-|\s)?contact sa (requester|customer)/i.test(norm) ||
    /(i-)?(message|chat) ang (requester|customer)/i.test(norm) ||
    /(mo|mag) ?(chat|message) sa (customer|requester)/i.test(norm) ||
    /(estoryaha|kontaka) ang (requester|customer)/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.CONTACT_REQUESTER,
      confidence: 'high',
      matchedRule: 'CONTACT_REQUESTER',
    };
  }

  // 4. Contact Station / Branch Direct Intent
  if (
    /(contact|message|chat|call) (the |my )?(station|branch|water station|manager)/i.test(norm) ||
    /how (do i |to )?(contact|message|chat|call|reach) (the |my )?(station|branch|water station|manager)/i.test(norm) ||
    /unsaon pag(-|\s)?contact sa (water )?(station|branch)/i.test(norm) ||
    /tawagi ang (water )?(branch|station)/i.test(norm) ||
    /kontaka ang (water )?(station|branch)/i.test(norm) ||
    /(i-)?message ang (water )?(station|branch)/i.test(norm) ||
    /contact (water )?station/i.test(norm) ||
    /contact branch/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.CONTACT_STATION,
      confidence: 'high',
      matchedRule: 'CONTACT_STATION',
    };
  }

  // 5. Next Delivery
  if (
    /(where|what) is my next delivery/i.test(norm) ||
    /next delivery/i.test(norm) ||
    /next schedule/i.test(norm) ||
    /when akong next schedule/i.test(norm) ||
    /when is my next delivery/i.test(norm) ||
    /when is my next schedule/i.test(norm) ||
    /asa akong sunod (nga )?delivery/i.test(norm) ||
    /unsa akong sunod/i.test(norm) ||
    /sunod (nga )?delivery/i.test(norm) ||
    /sunod (i-?)?deliver/i.test(norm) ||
    /sunod (i-?)?hatod/i.test(norm) ||
    /sunod nga schedule/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.NEXT_DELIVERY,
      confidence: 'high',
      matchedRule: 'NEXT_DELIVERY',
    };
  }

  // 6. Current Delivery (Evaluated before Today's Schedule)
  if (
    /what[\s']*s my (current|active) delivery/i.test(norm) ||
    /what is my (current|active) delivery/i.test(norm) ||
    /current delivery/i.test(norm) ||
    /active delivery/i.test(norm) ||
    /asa akong (current )?delivery/i.test(norm) ||
    /unsa akong delivery karon/i.test(norm) ||
    /unsa akong ihatod karon/i.test(norm) ||
    /kinsa akong ihatod karon/i.test(norm) ||
    /kinsa akong delivery karon/i.test(norm) ||
    /kinsa akong requester/i.test(norm) ||
    /who is my requester/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.CURRENT_DELIVERY,
      confidence: 'high',
      matchedRule: 'CURRENT_DELIVERY',
    };
  }

  // 7. Today's Delivery Schedule
  if (
    /what[\s']*s my schedule today/i.test(norm) ||
    /what is my schedule today/i.test(norm) ||
    /what are my deliveries today/i.test(norm) ||
    /deliveries today/i.test(norm) ||
    /mga delivery today/i.test(norm) ||
    /mga delivery karon/i.test(norm) ||
    /today[\s']*s (deliveries|schedule)/i.test(norm) ||
    /todays (deliveries|schedule)/i.test(norm) ||
    /schedule today/i.test(norm) ||
    /unsa akong schedule today/i.test(norm) ||
    /unsa akong schedule karon/i.test(norm) ||
    /pila akong delivery today/i.test(norm) ||
    /pila akong delivery karon/i.test(norm) ||
    /delivery schedule karon/i.test(norm) ||
    /schedule karon/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.TODAY_SCHEDULE,
      confidence: 'high',
      matchedRule: 'TODAY_SCHEDULE',
    };
  }

  // 8. Delivery Details
  if (
    /delivery details/i.test(norm) ||
    /show delivery details/i.test(norm) ||
    /detalye sa delivery/i.test(norm) ||
    /order details/i.test(norm) ||
    /tan-awa ang delivery/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.DELIVERY_DETAILS,
      confidence: 'high',
      matchedRule: 'DELIVERY_DETAILS',
    };
  }

  // 9. Delivery Location & Navigation Help
  if (
    /delivery location/i.test(norm) ||
    /where to deliver/i.test(norm) ||
    /asa ihatod/i.test(norm) ||
    /location sa requester/i.test(norm) ||
    /address sa (customer|requester)/i.test(norm) ||
    /delivery address/i.test(norm) ||
    /unsaon pag adto/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.DELIVERY_LOCATION_HELP,
      confidence: 'high',
      matchedRule: 'DELIVERY_LOCATION_HELP',
    };
  }

  // 10. Notifications
  if (
    /(latest|my) notification/i.test(norm) ||
    /unsa akong notification/i.test(norm) ||
    /any delivery updates/i.test(norm) ||
    /mga pahibalo/i.test(norm) ||
    /notifications/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.VIEW_NOTIFICATIONS,
      confidence: 'high',
      matchedRule: 'VIEW_NOTIFICATIONS',
    };
  }

  // 11. Delivery History
  if (
    /(delivery|my) history/i.test(norm) ||
    /past deliveries/i.test(norm) ||
    /completed deliveries/i.test(norm) ||
    /mga nahuman nga delivery/i.test(norm) ||
    /agi nga delivery/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.DELIVERY_HISTORY,
      confidence: 'high',
      matchedRule: 'DELIVERY_HISTORY',
    };
  }

  // 12. How Distributor Works
  if (
    /how (does )?(distributor )?(delivery|app) works?/i.test(norm) ||
    /how (does )?distributor works?/i.test(norm) ||
    /how delivery works?/i.test(norm) ||
    /unsaon paghatod/i.test(norm) ||
    /workflow sa distributor/i.test(norm) ||
    /unsaon pag[- ]?gamit sa distributor/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.HOW_DISTRIBUTOR_WORKS,
      confidence: 'high',
      matchedRule: 'HOW_DISTRIBUTOR_WORKS',
    };
  }

  // 13. Greetings
  if (
    /^(hi|hello|hey|good morning|good afternoon|good evening|greetings)\b/i.test(norm) ||
    /^(kumusta|komusta|maayong adlaw|maayong buntag|maayong hapon|maayong gabii|maayong gabi)\b/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.GREETING,
      confidence: 'high',
      matchedRule: 'GREETING',
    };
  }

  // 14. General Help
  if (
    /^help\b/i.test(norm) ||
    /what can you do/i.test(norm) ||
    /unsa imong (ma)?himo/i.test(norm) ||
    /unsa imong matabang/i.test(norm) ||
    /tabang(i)?( ko)?/i.test(norm)
  ) {
    return {
      intent: DISTRIBUTOR_ASSISTANT_INTENTS.GENERAL_HELP,
      confidence: 'high',
      matchedRule: 'GENERAL_HELP',
    };
  }

  return {
    intent: DISTRIBUTOR_ASSISTANT_INTENTS.UNKNOWN,
    confidence: 'low',
    matchedRule: null,
  };
}

export function classifyDistributorIntent(text = '') {
  return classifyDistributorIntentDetails(text).intent;
}

export function classifyRequesterIntent(text = '') {
  return classifyIntentDetails(text).intent;
}

export function classifyIntent(text = '', roleOrOpts = 'requester') {
  let role = roleOrOpts;
  if (roleOrOpts && typeof roleOrOpts === 'object') {
    role = roleOrOpts.role || 'requester';
  }
  if (String(role).toLowerCase() === 'distributor') {
    return classifyDistributorIntent(text);
  }
  return classifyRequesterIntent(text);
}
