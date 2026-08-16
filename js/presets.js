'use strict';

/**
 * Workspace presets. Each preset is a self-contained "use case" for the tracker:
 * its own categories, accent colour and icon. Adding a use case means adding an
 * entry here — nothing else in the app is hard-coded to a domain.
 *
 * Category shape: { name, icon, keywords } — keywords drive automatic
 * categorisation of scanned receipts.
 */

export const PRESETS = {
  personal: {
    label: 'Personal',
    blurb: 'Everyday household spending',
    icon: '🏠',
    accent: '#4f46e5',
    expense: [
      { name: 'Groceries', icon: '🛒', keywords: ['supermarket', 'grocer', 'countdown', 'pak n save', 'paknsave', 'new world', 'woolworths', 'coles', 'aldi', 'tesco', 'sainsbury', 'safeway', 'kroger', 'trader joe', 'whole foods', 'four square', 'produce', 'butcher', 'bakery'] },
      { name: 'Dining & Takeaway', icon: '🍔', keywords: ['cafe', 'coffee', 'restaurant', 'bar ', 'pizza', 'sushi', 'burger', 'kebab', 'mcdonald', 'kfc', 'subway', 'starbucks', 'uber eats', 'ubereats', 'doordash', 'deliveroo', 'takeaway', 'bistro', 'eatery', 'diner'] },
      { name: 'Transport', icon: '🚌', keywords: ['uber', 'taxi', 'lyft', 'bus', 'train', 'metro', 'rail', 'ferry', 'parking', 'toll', 'at hop', 'snapper', 'oyster'] },
      { name: 'Fuel', icon: '⛽', keywords: ['fuel', 'petrol', 'diesel', 'gasoline', 'bp ', 'z energy', 'mobil', 'caltex', 'gull', 'shell', 'chevron', 'exxon', 'service station'] },
      { name: 'Rent & Mortgage', icon: '🔑', keywords: ['rent', 'mortgage', 'landlord', 'tenancy', 'property manage'] },
      { name: 'Utilities', icon: '💡', keywords: ['power', 'electric', 'gas bill', 'water', 'genesis', 'mercury', 'contact energy', 'meridian', 'utility', 'council'] },
      { name: 'Phone & Internet', icon: '📱', keywords: ['spark', 'vodafone', 'one nz', '2degrees', 'skinny', 'telstra', 'optus', 'verizon', 'at&t', 'broadband', 'mobile', 'fibre', 'internet'] },
      { name: 'Health & Medical', icon: '🩺', keywords: ['pharmacy', 'chemist', 'doctor', 'medical', 'dental', 'dentist', 'physio', 'optometrist', 'hospital', 'clinic', 'unichem', 'life pharmacy'] },
      { name: 'Insurance', icon: '🛡️', keywords: ['insurance', 'insur', 'aa insurance', 'tower', 'state ', 'ami ', 'policy'] },
      { name: 'Subscriptions', icon: '🔁', keywords: ['netflix', 'spotify', 'disney', 'apple.com', 'itunes', 'google', 'youtube', 'prime', 'subscription', 'membership', 'patreon', 'dropbox', 'icloud'] },
      { name: 'Shopping', icon: '🛍️', keywords: ['warehouse', 'kmart', 'briscoes', 'farmers', 'amazon', 'ebay', 'target', 'walmart', 'ikea', 'clothing', 'apparel', 'shoes', 'department'] },
      { name: 'Home & Garden', icon: '🪴', keywords: ['bunnings', 'mitre 10', 'mitre10', 'placemakers', 'home depot', 'lowes', 'hardware', 'garden centre', 'nursery', 'furniture'] },
      { name: 'Entertainment', icon: '🎬', keywords: ['cinema', 'movie', 'event', 'ticket', 'concert', 'theatre', 'gym', 'sport', 'club'] },
      { name: 'Kids & Education', icon: '🎒', keywords: ['school', 'daycare', 'childcare', 'kindergarten', 'tuition', 'university', 'course', 'stationery'] },
      { name: 'Pets', icon: '🐾', keywords: ['vet', 'petstock', 'animates', 'pet food', 'petco', 'petsmart', 'grooming'] },
      { name: 'Gifts & Donations', icon: '🎁', keywords: ['gift', 'donation', 'charity', 'koha', 'flowers'] },
      { name: 'Fees & Bank Charges', icon: '🏦', keywords: ['bank fee', 'interest', 'account fee', 'atm', 'overdraft', 'transaction fee'] },
      { name: 'Other', icon: '📦', keywords: [] },
    ],
    income: [
      { name: 'Salary & Wages', icon: '💼', keywords: ['salary', 'wages', 'payroll', 'pay run'] },
      { name: 'Refund', icon: '↩️', keywords: ['refund', 'credit note', 'reimburse', 'return'] },
      { name: 'Interest & Dividends', icon: '📈', keywords: ['interest', 'dividend', 'investment'] },
      { name: 'Gift Received', icon: '🎁', keywords: [] },
      { name: 'Other Income', icon: '💰', keywords: [] },
    ],
  },

  business: {
    label: 'Small Business',
    blurb: 'Trade, contracting or a side hustle',
    icon: '💼',
    accent: '#0f766e',
    expense: [
      { name: 'Materials & Stock', icon: '🧱', keywords: ['supplies', 'materials', 'timber', 'steel', 'wholesale', 'bunnings', 'mitre 10', 'placemakers', 'carters', 'ittm', 'stock'] },
      { name: 'Subcontractors', icon: '👷', keywords: ['subcontract', 'labour hire', 'contractor'] },
      { name: 'Tools & Equipment', icon: '🧰', keywords: ['tool', 'equipment', 'makita', 'dewalt', 'milwaukee', 'hire', 'plant hire'] },
      { name: 'Vehicle & Fuel', icon: '🚚', keywords: ['fuel', 'petrol', 'diesel', 'bp ', 'z energy', 'mobil', 'caltex', 'gull', 'shell', 'rego', 'wof', 'service', 'tyres', 'ruc'] },
      { name: 'Travel & Accommodation', icon: '✈️', keywords: ['airline', 'air nz', 'jetstar', 'qantas', 'hotel', 'motel', 'airbnb', 'flight', 'accommodation'] },
      { name: 'Software & Subscriptions', icon: '💻', keywords: ['xero', 'microsoft', 'adobe', 'google', 'saas', 'subscription', 'licence', 'license', 'aws', 'hosting', 'domain', 'slack', 'zoom'] },
      { name: 'Marketing & Advertising', icon: '📣', keywords: ['advert', 'marketing', 'facebook ads', 'google ads', 'meta platforms', 'signage', 'print', 'website'] },
      { name: 'Office & Admin', icon: '🗂️', keywords: ['officemax', 'warehouse stationery', 'staples', 'stationery', 'postage', 'nz post', 'courier', 'printing'] },
      { name: 'Insurance', icon: '🛡️', keywords: ['insurance', 'liability', 'acc levy', 'policy'] },
      { name: 'Accounting & Legal', icon: '⚖️', keywords: ['accountant', 'bookkeep', 'lawyer', 'legal', 'solicitor', 'audit', 'ird', 'tax agent'] },
      { name: 'Rent & Utilities', icon: '🏢', keywords: ['rent', 'lease', 'power', 'electric', 'water', 'internet', 'broadband'] },
      { name: 'Wages & Contractors', icon: '💵', keywords: ['wages', 'payroll', 'paye', 'kiwisaver', 'salary'] },
      { name: 'Training & Compliance', icon: '🎓', keywords: ['training', 'course', 'certification', 'licence renewal', 'site safe', 'health and safety'] },
      { name: 'Bank & Merchant Fees', icon: '🏦', keywords: ['bank fee', 'merchant fee', 'stripe', 'paypal', 'square', 'interest', 'eftpos fee'] },
      { name: 'Other', icon: '📦', keywords: [] },
    ],
    income: [
      { name: 'Client Payment', icon: '🧾', keywords: ['invoice', 'payment received', 'client', 'progress claim'] },
      { name: 'Deposit', icon: '💳', keywords: ['deposit', 'retainer', 'upfront'] },
      { name: 'Grant & Subsidy', icon: '🏛️', keywords: ['grant', 'subsidy', 'funding', 'rebate'] },
      { name: 'Interest', icon: '📈', keywords: ['interest'] },
      { name: 'Other Income', icon: '💰', keywords: [] },
    ],
  },

  lifestyle: {
    label: 'Lifestyle Block',
    blurb: 'Small farm, orchard or land block',
    icon: '🌿',
    accent: '#2d7a45',
    expense: [
      { name: 'Lease Payment', icon: '🏡', keywords: ['lease', 'land trust', 'rent', 'grazing right'] },
      { name: 'Feed & Supplements', icon: '🌾', keywords: ['hay', 'silage', 'balage', 'feed', 'nuts', 'pellets', 'mineral', 'lick', 'chaff', 'grain'] },
      { name: 'Veterinary & Animal Health', icon: '🩺', keywords: ['vet', 'drench', 'vaccine', 'animal health', 'ear tag', 'nait', 'worming'] },
      { name: 'Fencing', icon: '🪵', keywords: ['fence', 'fencing', 'post', 'batten', 'wire', 'staple', 'electric fence', 'gate'] },
      { name: 'Equipment & Machinery', icon: '🚜', keywords: ['tractor', 'implement', 'mower', 'quad', 'atv', 'machinery', 'attachment', 'chainsaw'] },
      { name: 'Fuel', icon: '⛽', keywords: ['fuel', 'petrol', 'diesel', 'bp ', 'z energy', 'mobil', 'caltex', 'gull', 'allied'] },
      { name: 'Electricity', icon: '⚡', keywords: ['power', 'electric', 'genesis', 'mercury', 'meridian', 'contact energy', 'trustpower'] },
      { name: 'Water & Irrigation', icon: '💧', keywords: ['water', 'irrigation', 'bore', 'pump', 'trough', 'tank'] },
      { name: 'Seeds & Plants', icon: '🌱', keywords: ['seed', 'seedling', 'plant', 'tree', 'nursery', 'grass seed', 'pasture'] },
      { name: 'Fertiliser & Sprays', icon: '🧪', keywords: ['fertiliser', 'fertilizer', 'urea', 'lime', 'spray', 'herbicide', 'roundup', 'ballance', 'ravensdown'] },
      { name: 'Insurance', icon: '🛡️', keywords: ['insurance', 'policy', 'fmg'] },
      { name: 'Rates', icon: '📜', keywords: ['rates', 'council', 'regional council'] },
      { name: 'Repairs & Maintenance', icon: '🔧', keywords: ['repair', 'maintenance', 'service', 'parts', 'welding', 'hardware', 'mitre 10', 'bunnings', 'farmlands', 'pgg wrightson', 'rd1'] },
      { name: 'Labour & Contracting', icon: '👷', keywords: ['labour', 'contractor', 'shearing', 'baling', 'cartage', 'digger', 'excavat'] },
      { name: 'Other', icon: '📦', keywords: [] },
    ],
    income: [
      { name: 'Livestock Sales', icon: '🐄', keywords: ['livestock', 'lamb', 'cattle', 'stock sale', 'saleyard', 'meat co', 'silver fern', 'affco'] },
      { name: 'Produce Sales', icon: '🥕', keywords: ['produce', 'market', 'eggs', 'vegetable', 'fruit', 'honey'] },
      { name: 'Rental Income', icon: '🏘️', keywords: ['rent', 'grazing', 'lease income'] },
      { name: 'Grant & Subsidy', icon: '🏛️', keywords: ['grant', 'subsidy', 'funding', 'rebate'] },
      { name: 'Other Income', icon: '💰', keywords: [] },
    ],
  },

  rental: {
    label: 'Rental Property',
    blurb: 'Investment property income and costs',
    icon: '🏘️',
    accent: '#b45309',
    expense: [
      { name: 'Mortgage Interest', icon: '🏦', keywords: ['interest', 'mortgage', 'loan'] },
      { name: 'Rates', icon: '📜', keywords: ['rates', 'council', 'water rates'] },
      { name: 'Insurance', icon: '🛡️', keywords: ['insurance', 'landlord', 'policy'] },
      { name: 'Repairs & Maintenance', icon: '🔧', keywords: ['repair', 'plumber', 'electrician', 'builder', 'maintenance', 'handyman', 'bunnings', 'mitre 10'] },
      { name: 'Property Management', icon: '🗝️', keywords: ['management fee', 'property manage', 'letting fee', 'ray white', 'barfoot'] },
      { name: 'Cleaning & Gardening', icon: '🧹', keywords: ['clean', 'garden', 'lawn', 'mowing', 'rubbish'] },
      { name: 'Utilities', icon: '💡', keywords: ['power', 'electric', 'water', 'gas', 'internet'] },
      { name: 'Body Corporate', icon: '🏢', keywords: ['body corporate', 'strata', 'levy'] },
      { name: 'Legal & Accounting', icon: '⚖️', keywords: ['lawyer', 'legal', 'accountant', 'tribunal', 'conveyanc'] },
      { name: 'Advertising & Letting', icon: '📣', keywords: ['trade me', 'trademe', 'advertis', 'listing', 'photograph'] },
      { name: 'Other', icon: '📦', keywords: [] },
    ],
    income: [
      { name: 'Rent Received', icon: '🏠', keywords: ['rent', 'tenant', 'weekly rent'] },
      { name: 'Bond & Deposit', icon: '🔒', keywords: ['bond', 'deposit'] },
      { name: 'Insurance Payout', icon: '🛡️', keywords: ['claim', 'payout', 'settlement'] },
      { name: 'Other Income', icon: '💰', keywords: [] },
    ],
  },

  trip: {
    label: 'Trip / Travel',
    blurb: 'A holiday, tour or work trip budget',
    icon: '✈️',
    accent: '#0284c7',
    expense: [
      { name: 'Flights', icon: '✈️', keywords: ['air ', 'airline', 'airways', 'jetstar', 'qantas', 'emirates', 'flight', 'baggage'] },
      { name: 'Accommodation', icon: '🛏️', keywords: ['hotel', 'motel', 'hostel', 'airbnb', 'booking.com', 'lodge', 'campground', 'holiday park', 'resort'] },
      { name: 'Transport & Car Hire', icon: '🚗', keywords: ['rental car', 'hertz', 'avis', 'europcar', 'taxi', 'uber', 'train', 'bus', 'ferry', 'metro', 'toll', 'parking', 'fuel', 'petrol'] },
      { name: 'Food & Drink', icon: '🍽️', keywords: ['restaurant', 'cafe', 'bar ', 'coffee', 'lunch', 'dinner', 'takeaway', 'supermarket', 'grocer'] },
      { name: 'Activities & Tours', icon: '🎟️', keywords: ['tour', 'ticket', 'museum', 'entry', 'admission', 'experience', 'ski', 'dive', 'cruise'] },
      { name: 'Shopping & Souvenirs', icon: '🛍️', keywords: ['gift', 'souvenir', 'duty free', 'shop'] },
      { name: 'Fees & Insurance', icon: '🛡️', keywords: ['travel insurance', 'visa', 'fx fee', 'foreign', 'conversion', 'atm', 'esta'] },
      { name: 'Other', icon: '📦', keywords: [] },
    ],
    income: [
      { name: 'Reimbursement', icon: '↩️', keywords: ['reimburse', 'expense claim', 'refund'] },
      { name: 'Shared Cost', icon: '🤝', keywords: ['split', 'share', 'settle up'] },
      { name: 'Other Income', icon: '💰', keywords: [] },
    ],
  },

  project: {
    label: 'Project / Reno',
    blurb: 'A build, renovation or one-off project',
    icon: '🔨',
    accent: '#be123c',
    expense: [
      { name: 'Materials', icon: '🧱', keywords: ['bunnings', 'mitre 10', 'placemakers', 'carters', 'home depot', 'timber', 'gib', 'plasterboard', 'concrete', 'paint', 'tile', 'material'] },
      { name: 'Labour & Trades', icon: '👷', keywords: ['builder', 'plumber', 'electrician', 'painter', 'plasterer', 'labour', 'trade', 'roofer', 'tiler'] },
      { name: 'Tools & Hire', icon: '🧰', keywords: ['hire', 'tool', 'scaffold', 'skip bin', 'digger', 'plant hire', 'kennards', 'hirepool'] },
      { name: 'Permits & Fees', icon: '📋', keywords: ['council', 'consent', 'permit', 'inspection', 'code compliance', 'fee'] },
      { name: 'Design & Consultants', icon: '📐', keywords: ['architect', 'designer', 'engineer', 'survey', 'draft', 'consultant'] },
      { name: 'Fixtures & Appliances', icon: '🚿', keywords: ['appliance', 'tap', 'sink', 'oven', 'fridge', 'shower', 'vanity', 'lighting', 'plumbing world'] },
      { name: 'Delivery & Freight', icon: '🚚', keywords: ['delivery', 'freight', 'cartage', 'courier'] },
      { name: 'Other', icon: '📦', keywords: [] },
    ],
    income: [
      { name: 'Budget Top-up', icon: '💳', keywords: ['transfer', 'top up', 'drawdown'] },
      { name: 'Rebate & Refund', icon: '↩️', keywords: ['rebate', 'refund', 'credit note', 'return'] },
      { name: 'Other Income', icon: '💰', keywords: [] },
    ],
  },

  blank: {
    label: 'Start Blank',
    blurb: 'Just two categories — add your own',
    icon: '✨',
    accent: '#7c3aed',
    expense: [{ name: 'General', icon: '📦', keywords: [] }],
    income: [{ name: 'General Income', icon: '💰', keywords: [] }],
  },
};

export const ACCENTS = [
  '#4f46e5', '#0f766e', '#2d7a45', '#b45309', '#0284c7', '#be123c', '#7c3aed', '#334155',
];

/** Keywords that apply regardless of preset — used as a fallback signal. */
export const GLOBAL_HINTS = [
  { match: ['supermarket', 'countdown', 'pak n save', 'new world', 'woolworths', 'grocer'], want: ['Groceries', 'Food & Drink'] },
  { match: ['petrol', 'diesel', 'fuel', 'z energy', 'bp connect', 'caltex', 'mobil'], want: ['Fuel', 'Vehicle & Fuel', 'Transport & Car Hire'] },
  { match: ['pharmacy', 'chemist'], want: ['Health & Medical'] },
  { match: ['bunnings', 'mitre 10', 'placemakers', 'hardware'], want: ['Materials', 'Repairs & Maintenance', 'Home & Garden', 'Materials & Stock'] },
];

export function presetCategories(presetKey) {
  const p = PRESETS[presetKey] || PRESETS.personal;
  return {
    expense: p.expense.map(c => ({ ...c, keywords: [...c.keywords] })),
    income: p.income.map(c => ({ ...c, keywords: [...c.keywords] })),
  };
}
