import { LiveRecordDetail } from '../../../features/inventory/live-detail';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LiveRecordDetail id={id} updates={false} />;
}
