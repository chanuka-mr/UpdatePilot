import Link from "next/link";
import {Heading} from "../../components/ui/dashboard";
export default function Page(){return <><Heading title="Security Insights" description="Verified advisory information will appear when reliable source data is connected."/><section className="panel p-10 text-center"><h2 className="text-lg font-semibold">No verified findings available</h2><p className="mt-3 text-muted">The sample catalog does not establish vulnerability severity.</p><Link href="/updates" className="mt-6 inline-block text-primary">Review sample updates →</Link></section></>;}
