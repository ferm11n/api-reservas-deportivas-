import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AlmacenTokensPush,
  type Plataforma,
} from '../common/notifications/ports.js';
import { DispositivoEntidad } from '../common/notifications/device.entity.js';

@Injectable()
export class AlmacenTokensDb extends AlmacenTokensPush {
  constructor(
    @InjectRepository(DispositivoEntidad)
    private readonly dispositivos: Repository<DispositivoEntidad>,
  ) {
    super();
  }

  guardar(
    usuarioId: string,
    tokenExpo: string,
    plataforma: Plataforma,
  ): Promise<void> {
    return this.dispositivos
      .upsert({ usuarioId, tokenExpo, plataforma }, ['tokenExpo'])
      .then(() => undefined);
  }

  async borrar(tokenExpo: string): Promise<void> {
    await this.dispositivos.delete({ tokenExpo });
  }

  async tokensDe(usuarioIds: string[]): Promise<string[]> {
    if (usuarioIds.length === 0) return [];
    const dispositivos = await this.dispositivos.find({
      select: { tokenExpo: true },
      where: { usuarioId: In(usuarioIds) },
    });
    return dispositivos.map(({ tokenExpo }) => tokenExpo);
  }

  async descartar(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.dispositivos.delete({ tokenExpo: In(tokens) });
  }
}
