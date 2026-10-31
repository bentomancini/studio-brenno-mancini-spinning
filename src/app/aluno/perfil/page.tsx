import { ProtectedScreen } from '@/components/protected-screen';
import { StudentProfile } from '@/components/student-screens';
export const metadata = { title: 'Perfil' };
export default function Page() { return <ProtectedScreen path="/aluno/perfil"><StudentProfile /></ProtectedScreen>; }
