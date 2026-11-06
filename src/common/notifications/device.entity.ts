import { Entity, Index, PrimaryColumn } from 'typeorm';
import { ColumnaEnum, ColumnaTexto } from '../db/columns.js';
import type { Plataforma } from './ports.js';

@Index('IDX_dispositivos_usuarioId', ['usuarioId'])
@Entity('dispositivos')
export class DispositivoEntidad {
  @PrimaryColumn({ type: 'varchar', length: 240 })
  tokenExpo: string;

  @ColumnaTexto(40)
  usuarioId: string;

  @ColumnaEnum()
  plataforma: Plataforma;
}
