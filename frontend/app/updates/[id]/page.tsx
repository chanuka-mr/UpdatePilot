import {notFound} from "next/navigation";
import {updateApps} from "../../../lib/demo-data";
import {UpdatePreview} from "../../../features/updates/screens";
export function generateStaticParams(){return updateApps.map(a=>({id:a.id}));}
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;const app=updateApps.find(a=>a.id===id);if(!app)notFound();return <UpdatePreview app={app}/>;}
