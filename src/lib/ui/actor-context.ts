'use client';
import { createContext } from 'react';
import type { PrivateApi } from './private-api';

// Separate from the provider/visual primitives to avoid a UI import cycle.
export const PrivateActorContext = createContext<PrivateApi | null>(null);
