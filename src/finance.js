export const DEFAULT_CATEGORIES = ['Housing','Transportation','Groceries','Dining Out','Utilities','Insurance','Subscriptions','Shopping','Entertainment','Health','Personal','Savings Transfers','Other'];
export const FREQUENCIES = ['Weekly','Biweekly','Monthly','Quarterly','Yearly'];
export const today = () => new Date().toLocaleDateString('en-CA');
export const uid = () => crypto.randomUUID();
export const cents = value => {
  const cleaned = String(value ?? '').replace(/[$,\s]/g, '');
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const [whole, fraction = ''] = cleaned.split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(Number(whole || 0)) * 100 + Number(fraction.padEnd(2, '0')));
};
export const money = (n, currency = 'USD') => new Intl.NumberFormat(undefined, {style:'currency', currency}).format((n || 0) / 100);
export const dateObj = s => new Date(`${s}T12:00:00`);
export const addDays = (s, n) => { const d = dateObj(s); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
export const addMonths = (s, n) => { const d = dateObj(s), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const max = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); d.setDate(Math.min(day,max)); return d.toLocaleDateString('en-CA'); };
export const monthStart = s => `${s.slice(0,7)}-01`;
export const monthEnd = s => addDays(addMonths(monthStart(s),1),-1);
export const weekStart = (s, starts = 1) => { const d = dateObj(s), delta = (d.getDay()-starts+7)%7; return addDays(s,-delta); };
export const periodRange = (period, anchor, custom, starts = 1) => {
  if (period === 'week') { const from = weekStart(anchor,starts); return {from,to:addDays(from,6)}; }
  if (period === 'year') return {from:`${anchor.slice(0,4)}-01-01`,to:`${anchor.slice(0,4)}-12-31`};
  if (period === 'custom') return {from:custom.from || today(),to:custom.to || today()};
  return {from:monthStart(anchor),to:monthEnd(anchor)};
};
export const inRange = (date, range) => !!date && date >= range.from && date <= range.to;
export const actual = t => t.status === 'Received' || t.status === 'Paid' || t.status === 'Cleared';
export const sum = (items, get = x => x.amountCents) => items.reduce((total,item) => total + (get(item) || 0), 0);
export const metrics = (transactions, range, startingBalance = 0) => {
  const allActual = transactions.filter(actual);
  const rows = allActual.filter(t => inRange(t.date,range));
  const income = sum(rows.filter(t => t.type === 'Income'));
  const expenses = sum(rows.filter(t => t.type === 'Expense'));
  const transfers = sum(rows.filter(t => t.type === 'Transfer'));
  const savings = sum(rows.filter(t => t.type === 'Savings'), t => t.direction === 'in' ? -t.amountCents : t.amountCents);
  const balance = startingBalance + sum(allActual.filter(t => t.date <= range.to),t => t.type === 'Income' ? t.amountCents : t.type === 'Expense' ? -t.amountCents : t.type === 'Savings' ? (t.direction === 'in' ? t.amountCents : -t.amountCents) : 0);
  return {income,expenses,transfers,savings,remaining:income-expenses-savings,balance,rows};
};
export const nextDue = (date, frequency) => frequency === 'Weekly' ? addDays(date,7) : frequency === 'Biweekly' ? addDays(date,14) : frequency === 'Quarterly' ? addMonths(date,3) : frequency === 'Yearly' ? addMonths(date,12) : addMonths(date,1);
export const groupSum = (rows, key) => rows.reduce((acc,row) => { const k = key(row); acc[k] = (acc[k] || 0) + row.amountCents; return acc; },{});
export const csvCell = value => `"${String(value ?? '').replaceAll('"','""')}"`;
export const toCsv = rows => [ ['Date','Description','Category','Type','Amount','Status','Notes','Direction'].join(','), ...rows.map(t => [t.date,t.description,t.category,t.type,(t.amountCents/100).toFixed(2),t.status,t.notes,t.direction || 'out'].map(csvCell).join(','))].join('\r\n');
export function parseCsv(text) {
  const rows=[]; let row=[], cell='', quoted=false;
  for(let i=0;i<text.length;i++){ const c=text[i]; if(c==='"'){if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x!==''))rows.push(row);row=[];cell='';}else cell+=c; }
  if(quoted) throw Error('CSV has an unclosed quote.');
  row.push(cell); if(row.some(x=>x!=='')) rows.push(row);
  if(!rows.length)return [];
  const header=rows.shift().map(x=>x.trim().toLowerCase().replace(/^\ufeff/,''));
  const cols=['date','description','category','type','amount','status','notes','direction'];
  if(!cols.slice(0,5).every(c=>header.includes(c))) throw Error('CSV needs Date, Description, Category, Type, and Amount columns.');
  return rows.map((r,i)=>{const obj=Object.fromEntries(cols.map(c=>[c,r[header.indexOf(c)]?.trim() || ''])); const amountCents=cents(obj.amount);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(obj.date)||Number.isNaN(dateObj(obj.date).getTime()))throw Error(`Row ${i+2}: invalid date.`);
    if(!obj.description)throw Error(`Row ${i+2}: description is required.`);
    if(!['Income','Expense','Transfer','Savings'].includes(obj.type))throw Error(`Row ${i+2}: invalid type.`);
    if(amountCents===null||amountCents<0)throw Error(`Row ${i+2}: invalid amount.`);
    if(obj.direction && !['in','out'].includes(obj.direction))throw Error(`Row ${i+2}: invalid direction.`);
    return {id:uid(),date:obj.date,description:obj.description,category:obj.category || 'Other',type:obj.type,amountCents,status:obj.status || (obj.type==='Income'?'Received':'Paid'),notes:obj.notes,direction:obj.direction || 'out'};
  });
}
