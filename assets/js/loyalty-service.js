(function(){
  'use strict';

  const KEY='kweiderRewards.v1';
  const SETTINGS={pointsPerPound:1,pointsPerReward:100,rewardValue:5,version:2};
  const blank=()=>({version:2,members:[],currentMemberId:null,staffTransactions:[]});
  const now=()=>new Date().toISOString();
  const uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function normalizePhone(value){
    const raw=String(value||'').trim();
    if(!raw)return '';
    let digits=raw.replace(/\D/g,'');
    if(!digits)return '';

    if(digits.startsWith('0044'))digits=digits.slice(4);
    else if(digits.startsWith('44'))digits=digits.slice(2);
    else if(digits.startsWith('0'))digits=digits.slice(1);

    if(digits.startsWith('0'))digits=digits.slice(1);
    return digits?`+44${digits}`:'';
  }

  function makeId(){
    const d=new Date();
    const stamp=d.toISOString().slice(2,10).replace(/-/g,'');
    const rand=Math.floor(1000+Math.random()*9000);
    return `KW-${stamp}-${rand}`;
  }

  function sanitizeMember(m){
    if(!m||!m.id)return {};
    return {
      id:m.id,
      firstName:m.firstName||'',
      phone:normalizePhone(m.phone),
      email:m.email||'',
      birthday:m.birthday||'',
      marketingConsent:!!m.marketingConsent,
      points:Number(m.points)||0,
      createdAt:m.createdAt,
      updatedAt:m.updatedAt,
      transactions:Array.isArray(m.transactions)?m.transactions:[]
    };
  }

  function mergeTransactions(a=[],b=[]){
    const seen=new Set();
    return [...a,...b]
      .filter(t=>{
        const key=t.id||`${t.type}|${t.receipt||''}|${t.createdAt||''}|${t.points||0}`;
        if(seen.has(key))return false;
        seen.add(key);
        return true;
      })
      .sort((x,y)=>new Date(y.createdAt||0)-new Date(x.createdAt||0));
  }

  function migrate(input){
    const source=input&&Array.isArray(input.members)?input:blank();
    const out=blank();
    const byPhone=new Map();
    const idMap=new Map();

    for(const raw of source.members){
      if(!raw||!raw.id)continue;
      const member={
        ...raw,
        phone:normalizePhone(raw.phone),
        points:Number(raw.points)||0,
        transactions:Array.isArray(raw.transactions)?raw.transactions:[],
        createdAt:raw.createdAt||now(),
        updatedAt:raw.updatedAt||raw.createdAt||now()
      };
      const phoneKey=member.phone;
      const existing=phoneKey?byPhone.get(phoneKey):null;

      if(existing){
        existing.points=(Number(existing.points)||0)+(Number(member.points)||0);
        existing.transactions=mergeTransactions(existing.transactions,member.transactions);
        existing.updatedAt=[existing.updatedAt,member.updatedAt].filter(Boolean).sort().pop()||now();
        idMap.set(member.id,existing.id);
      }else{
        out.members.push(member);
        if(phoneKey)byPhone.set(phoneKey,member);
        idMap.set(member.id,member.id);
      }
    }

    out.currentMemberId=idMap.get(source.currentMemberId)||out.members[0]?.id||null;
    out.staffTransactions=(Array.isArray(source.staffTransactions)?source.staffTransactions:[]).map(t=>({
      ...t,
      memberId:idMap.get(t.memberId)||t.memberId
    }));
    out.version=2;
    return out;
  }

  function load(){
    try{
      const parsed=JSON.parse(localStorage.getItem(KEY));
      const migrated=migrate(parsed);
      const before=JSON.stringify(parsed||null);
      const after=JSON.stringify(migrated);
      if(before!==after)localStorage.setItem(KEY,after);
      return migrated;
    }catch(e){
      return blank();
    }
  }

  function save(data){
    const migrated=migrate(data);
    localStorage.setItem(KEY,JSON.stringify(migrated));
    window.dispatchEvent(new CustomEvent('kweider-rewards-updated'));
    return migrated;
  }

  function validateProfile(payload,requireName=true){
    const phone=normalizePhone(payload.phone);
    const firstName=String(payload.firstName||'').trim();
    if(requireName&&!firstName)throw new Error('Name is required.');
    if(!phone)throw new Error('Enter a valid UK phone number.');
    if(phone.length<12||phone.length>14)throw new Error('Enter a valid UK phone number.');
    return {
      firstName,
      phone,
      email:String(payload.email||'').trim(),
      birthday:payload.birthday||'',
      marketingConsent:!!payload.marketingConsent
    };
  }

  function register(payload){
    const d=load();
    const profile=validateProfile(payload,true);
    let member=d.members.find(m=>normalizePhone(m.phone)===profile.phone);

    if(member){
      d.currentMemberId=member.id;
      save(d);
      return sanitizeMember(member);
    }

    member={
      id:makeId(),
      ...profile,
      points:0,
      createdAt:now(),
      updatedAt:now(),
      transactions:[{
        id:uid(),type:'welcome',points:0,label:'Welcome to Kweider Rewards',
        receipt:'',amount:0,createdAt:now()
      }]
    };
    d.members.push(member);
    d.currentMemberId=member.id;
    save(d);
    return sanitizeMember(member);
  }

  function updateMember(memberId,payload){
    const d=load();
    const member=d.members.find(m=>m.id===memberId);
    if(!member)throw new Error('Membership not found.');
    const profile=validateProfile(payload,true);
    const duplicate=d.members.find(m=>m.id!==memberId&&normalizePhone(m.phone)===profile.phone);
    if(duplicate)throw new Error('This phone number already belongs to another membership. Open that membership instead.');
    Object.assign(member,profile,{updatedAt:now()});
    d.currentMemberId=member.id;
    save(d);
    return sanitizeMember(member);
  }

  function getCurrent(){
    const d=load();
    return sanitizeMember(d.members.find(m=>m.id===d.currentMemberId));
  }

  function getMember(query){
    const d=load();
    const text=String(query||'').trim();
    const idText=text.replace(/^KWEIDER-LOYALTY:/i,'').toLowerCase();
    const phone=normalizePhone(text);
    const member=d.members.find(m=>m.id.toLowerCase()===idText||(phone&&normalizePhone(m.phone)===phone));
    return member?sanitizeMember(member):null;
  }

  function listMembers(){
    return load().members.map(sanitizeMember).sort((a,b)=>new Date(a.createdAt||0)-new Date(b.createdAt||0));
  }

  function setCurrent(id){
    const d=load();
    if(!d.members.some(m=>m.id===id))return false;
    d.currentMemberId=id;
    save(d);
    return true;
  }

  function addPoints(memberId,amount,receipt,staff='Staff'){
    const d=load();
    const member=d.members.find(m=>m.id===memberId);
    if(!member)throw new Error('Member not found.');
    amount=Number(amount);
    receipt=String(receipt||'').trim();
    if(!Number.isFinite(amount)||amount<=0)throw new Error('Enter a valid purchase amount.');
    if(!receipt)throw new Error('Receipt number is required.');
    const used=d.members.some(m=>(m.transactions||[]).some(t=>t.receipt&&t.receipt.toLowerCase()===receipt.toLowerCase()));
    if(used)throw new Error('This receipt has already been used.');
    const points=Math.floor(amount*SETTINGS.pointsPerPound);
    const transaction={
      id:uid(),type:'earn',points,label:`Purchase £${amount.toFixed(2)}`,
      receipt,amount,staff,createdAt:now()
    };
    member.points=(Number(member.points)||0)+points;
    member.transactions=member.transactions||[];
    member.transactions.unshift(transaction);
    member.updatedAt=transaction.createdAt;
    d.staffTransactions.unshift({...transaction,memberId:member.id});
    save(d);
    return {member:sanitizeMember(member),transaction};
  }

  function redeem(memberId,rewardCount=1,receipt='',staff='Staff'){
    const d=load();
    const member=d.members.find(m=>m.id===memberId);
    if(!member)throw new Error('Member not found.');
    rewardCount=Math.max(1,Math.floor(Number(rewardCount)||1));
    receipt=String(receipt||'').trim();
    if(!receipt)throw new Error('Receipt/reference is required.');
    const cost=SETTINGS.pointsPerReward*rewardCount;
    if((Number(member.points)||0)<cost)throw new Error('The member does not have enough points.');
    const value=SETTINGS.rewardValue*rewardCount;
    const transaction={
      id:uid(),type:'redeem',points:-cost,label:`£${value.toFixed(2)} reward redeemed`,
      receipt,amount:-value,staff,createdAt:now()
    };
    member.points-=cost;
    member.transactions=member.transactions||[];
    member.transactions.unshift(transaction);
    member.updatedAt=transaction.createdAt;
    d.staffTransactions.unshift({...transaction,memberId:member.id});
    save(d);
    return {member:sanitizeMember(member),transaction};
  }

  function stats(){
    const d=load();
    const points=d.members.reduce((sum,m)=>sum+(Number(m.points)||0),0);
    const redeemed=d.staffTransactions.filter(t=>t.type==='redeem').reduce((sum,t)=>sum+Math.abs(Number(t.amount)||0),0);
    return {members:d.members.length,points,redeemed,transactions:d.staffTransactions.length};
  }

  function exportData(){return JSON.stringify(load(),null,2);}
  function importData(raw){
    const parsed=JSON.parse(raw);
    if(!parsed||!Array.isArray(parsed.members))throw new Error('Invalid data file.');
    return save(parsed);
  }
  function reset(){
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent('kweider-rewards-updated'));
  }

  window.KweiderRewards={
    settings:SETTINGS,load,register,updateMember,getCurrent,getMember,listMembers,
    setCurrent,addPoints,redeem,stats,exportData,importData,reset,normalizePhone
  };
})();
