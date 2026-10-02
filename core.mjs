export function classify(e,id) {
 if(e.httpStatus>=400)return {status:'error',detail:'官网拒绝读取（HTTP '+e.httpStatus+'）'};
 if(!e.url?.includes('-'+id+'/')||!e.text?.includes(id))return {status:'error',detail:'未能确认指定商品，可能遇到验证页'};
 if(e.blocked)return {status:'error',detail:'官网要求人机验证，库存未知'};
 if(e.unavailable&&e.enabled)return {status:'error',detail:'库存信号不一致，等待下次确认'};
 if(e.unavailable)return {status:'unavailable',detail:'官网显示所选商品缺货'};
 if(e.enabled)return {status:'available',detail:'官网加入购物车按钮可用'};
 return {status:'error',detail:'未找到明确库存信号'};
}
export function transition(previous,result){
 const p=previous||{stable:'unknown',cycle:0,notifiedCycle:-1};
 if(result.status==='error')return {...p,...result};
 const cycle=result.status==='available'&&p.stable!=='available'?p.cycle+1:p.cycle;
 return {...p,...result,stable:result.status,cycle};
}
export function needsNotification(state){return state.status==='available'&&state.notifiedCycle!==state.cycle}
