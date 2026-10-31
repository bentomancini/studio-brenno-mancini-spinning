import { AuthScreen } from '@/components/auth-screen';
export const metadata = { title: 'Recuperar acesso' };
export default async function Page({ searchParams }: { searchParams: Promise<{ result?: string }> }) { const params = await searchParams; return <AuthScreen mode="recovery" result={params.result} />; }
