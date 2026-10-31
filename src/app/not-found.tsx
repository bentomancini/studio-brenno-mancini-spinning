import Link from 'next/link';
import { Brand } from '@/components/ui';
import styles from '@/components/studio.module.css';
export default function NotFound() { return <main id="conteudo" className={styles.statusPage}><Brand /><h1>Este caminho não está na agenda.</h1><p>A página não foi encontrada. Volte ao início para continuar.</p><Link className="button" href="/">Voltar ao início</Link></main>; }
