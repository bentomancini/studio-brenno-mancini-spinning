import { ProtectedScreen } from '@/components/protected-screen';
import { AdminCatalog } from '@/components/admin-screens';
export const metadata = { title: 'Alunos' };
export default function Page() { return <ProtectedScreen path="/admin/alunos" admin><AdminCatalog kind="students" /></ProtectedScreen>; }
