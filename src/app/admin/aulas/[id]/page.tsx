import { ProtectedScreen } from '@/components/protected-screen';
import { AdminSessionDetail } from '@/components/admin-screens';
import { uuid } from '@/contracts';
import { notFound } from 'next/navigation';
export const metadata = { title: 'Gerenciar aula' };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; if (!uuid.safeParse(id).success) notFound(); return <ProtectedScreen path={`/admin/aulas/${id}`} admin><AdminSessionDetail id={id} /></ProtectedScreen>; }
