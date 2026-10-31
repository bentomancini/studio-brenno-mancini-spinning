import { ProtectedScreen } from '@/components/protected-screen';
import { SessionDetail } from '@/components/student-screens';
import { uuid } from '@/contracts';
import { notFound } from 'next/navigation';
export const metadata = { title: 'Sua aula' };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; if (!uuid.safeParse(id).success) notFound(); return <ProtectedScreen path={`/aluno/aulas/${id}`}><SessionDetail id={id} /></ProtectedScreen>; }
