'use client';
import Link from 'next/link';
import { Brand, Button } from '@/components/ui';
import styles from '@/components/studio.module.css';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main id="conteudo" className={styles.statusPage}><Brand /><h1>Não foi possível abrir esta página.</h1><p>Tente novamente. Se você estava reservando, verifique a situação da operação antes de repetir.</p><div className="actions"><Button onClick={reset}>Tentar novamente</Button><Link href="/">Voltar ao início</Link></div></main>; }
