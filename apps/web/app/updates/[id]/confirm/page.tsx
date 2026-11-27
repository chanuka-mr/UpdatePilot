import {UpdateConfirmation} from "../../../../features/updates/update-confirmation";
export const dynamic = 'force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{name?:string|string[]}>}){
  const {id}=await params;
  const {name}=await searchParams;
  return <UpdateConfirmation recordId={id} name={typeof name==='string'?name:'Update candidate'}/>;
}
