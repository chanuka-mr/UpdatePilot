import {notFound} from "next/navigation";
import {findApp,apps,updateApps} from "../../../lib/demo-data";
import {ApplicationDetails} from "../../../features/inventory/screens";
export function generateStaticParams(){return [...new Set([...apps,...updateApps].map(a=>a.id))].map(id=>({id}));}
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;const app=findApp(id);if(!app)notFound();return <ApplicationDetails app={app}/>;}
