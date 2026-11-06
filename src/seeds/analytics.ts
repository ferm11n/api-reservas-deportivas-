import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Between, In } from 'typeorm';
import { hashContrasena } from '../common/auth/passwords.js';
import { diaEnZona, instanteEnZona, sumarDias } from '../common/dates/dates.js';
import { nuevoId, textoAleatorio } from '../common/ids/ids.js';
import { validarEntorno } from '../config/environment.js';
import type { UsuarioEntidad } from '../modules/users/user.entity.js';
import {
  fechaInicioAnalitica,
  generarTurnosFicticios,
} from './analytics-data.js';

const CANTIDAD_POR_DEFECTO = 300;
const MESES_POR_DEFECTO = 6;
const CANTIDAD_USUARIOS = 20;
const ALFABETO_QR = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAMANO_LOTE = 100;
const MAXIMA_CANTIDAD = 5_000;
const MAXIMOS_MESES = 36;

interface Argumentos {
  cantidad: number;
  meses: number;
  confirmar: boolean;
  permitirRemoto: boolean;
}

function enteroPositivo(valor: string | undefined, nombre: string): number {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1)
    throw new Error(`${nombre} debe ser un entero positivo.`);
  const maximo = nombre === '--cantidad' ? MAXIMA_CANTIDAD : MAXIMOS_MESES;
  if (numero > maximo) throw new Error(`${nombre} no puede superar ${maximo}.`);
  return numero;
}

function leerArgumentos(argv: string[]): Argumentos {
  const leerOpcion = (nombre: string): string | undefined => {
    const prefijo = `--${nombre}=`;
    const argumento = argv.find((item) => item.startsWith(prefijo));
    return argumento?.slice(prefijo.length);
  };
  const desconocidos = argv.filter(
    (item) =>
      item !== '--confirmar' &&
      item !== '--permitir-remoto' &&
      !item.startsWith('--cantidad=') &&
      !item.startsWith('--meses='),
  );
  if (desconocidos.length)
    throw new Error(`Opciones desconocidas: ${desconocidos.join(', ')}`);

  return {
    cantidad: enteroPositivo(
      leerOpcion('cantidad') ?? String(CANTIDAD_POR_DEFECTO),
      '--cantidad',
    ),
    meses: enteroPositivo(
      leerOpcion('meses') ?? String(MESES_POR_DEFECTO),
      '--meses',
    ),
    confirmar: argv.includes('--confirmar'),
    permitirRemoto: argv.includes('--permitir-remoto'),
  };
}

function correoAnalitico(indice: number): string {
  return `reserva-ficticia-${String(indice + 1).padStart(2, '0')}@example.invalid`;
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = validarEntorno(process.env);
  const args = leerArgumentos(process.argv.slice(2));
  const [
    { NestFactory },
    { DataSource },
    { AppModule },
    { Reloj },
    { ReservaEntidad },
    { ReservaFijaEntidad },
    { BloqueoEntidad },
    { EspacioEntidad },
    { UsuarioEntidad },
    { codigoQrDe },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('typeorm'),
    import('../app.module.js'),
    import('../common/clock/clock.js'),
    import('../modules/slots/reserva.entity.js'),
    import('../modules/slots/standing-booking.entity.js'),
    import('../modules/slots/block.entity.js'),
    import('../modules/venues/venue.entity.js'),
    import('../modules/users/user.entity.js'),
    import('../modules/bookings/rules/bookings.js'),
  ]);
  const baseLocal =
    config.entorno === 'desarrollo' &&
    config.db.motor === 'better-sqlite3' &&
    config.db.proveedor === null;

  if (!args.confirmar) {
    throw new Error(
      'No se escribieron datos. Repetí el comando con --confirmar para agregar el dataset.',
    );
  }
  if (!baseLocal && !args.permitirRemoto) {
    throw new Error(
      'Por seguridad, el seed sólo escribe en SQLite local. Para una base externa, agregá --permitir-remoto y --confirmar.',
    );
  }
  if (baseLocal && args.permitirRemoto) {
    throw new Error(
      '--permitir-remoto sólo corresponde a una base externa; revisá tu configuración.',
    );
  }

  const destino = baseLocal
    ? `SQLite local (${config.db.archivo})`
    : `${config.db.proveedor ?? config.db.motor}${config.db.esquema ? `, esquema ${config.db.esquema}` : ''}`;
  console.log(
    `Se agregarán ${args.cantidad} reservas ficticias de los últimos ${args.meses} meses a ${destino}. No se borrarán registros. Repetir el comando agrega otra tanda.`,
  );

  const app = await NestFactory.createApplicationContext(
    AppModule.registrar(),
    {
      logger: ['error', 'warn'],
      abortOnError: false,
    },
  );

  try {
    const dataSource = app.get(DataSource);
    const reloj = app.get(Reloj);
    const ahora = reloj.ahora();
    const hoy = diaEnZona(ahora);
    const desde = fechaInicioAnalitica(ahora, args.meses);
    const hasta = sumarDias(hoy, -1);

    const espaciosRepo = dataSource.getRepository(EspacioEntidad);
    const usuariosRepo = dataSource.getRepository(UsuarioEntidad);
    const reservasRepo = dataSource.getRepository(ReservaEntidad);
    const [espacios, fijas, bloqueos, reservasExistentes, todosLosQrs] =
      await Promise.all([
        espaciosRepo.find({ where: { activo: true } }),
        dataSource.getRepository(ReservaFijaEntidad).find(),
        dataSource
          .getRepository(BloqueoEntidad)
          .find({ where: { fecha: Between(desde, hasta) } }),
        reservasRepo.find({
          where: { fecha: Between(desde, hasta) },
          select: { espacioId: true, fecha: true, inicio: true },
        }),
        reservasRepo.find({ select: { codigoQr: true } }),
      ]);
    if (espacios.length === 0)
      throw new Error(
        'No hay espacios activos. Cargá primero los datos de demo.',
      );

    const turnos = generarTurnosFicticios({
      ahora,
      meses: args.meses,
      cantidad: args.cantidad,
      espacios,
      fijas,
      bloqueos,
      reservasExistentes,
    });

    const correos = Array.from({ length: CANTIDAD_USUARIOS }, (_, indice) =>
      correoAnalitico(indice),
    );
    const usuariosExistentes = await usuariosRepo.find({
      where: { email: In(correos) },
    });
    const porCorreo = new Map(
      usuariosExistentes.map((usuario) => [usuario.email, usuario]),
    );
    const fechaAlta = instanteEnZona(sumarDias(desde, -31), '12:00');
    const usuariosNuevos: UsuarioEntidad[] = [];
    for (let indice = 0; indice < CANTIDAD_USUARIOS; indice++) {
      const email = correoAnalitico(indice);
      if (porCorreo.has(email)) continue;
      usuariosNuevos.push({
        id: nuevoId('usr'),
        nombre: `Cliente ficticio ${String(indice + 1).padStart(2, '0')}`,
        email,
        telefono: `0000-${String(indice + 1).padStart(6, '0')}`,
        rol: 'jugador',
        contrasenaHash: await hashContrasena(
          randomBytes(32).toString('base64url'),
        ),
        cancelacionesTardias: 0,
        ausencias: 0,
        creadoEn: fechaAlta,
      });
    }

    const usuarios = [...usuariosExistentes, ...usuariosNuevos].sort((a, b) =>
      a.email.localeCompare(b.email),
    );
    if (usuarios.length === 0)
      throw new Error('No se pudieron preparar las cuentas ficticias.');

    const codigosQr = new Set(todosLosQrs.map(({ codigoQr }) => codigoQr));
    const ausenciasPorUsuario = new Map<string, number>();
    const reservas = turnos.map((turno) => {
      const usuario = usuarios[Math.floor(Math.random() * usuarios.length)];
      let codigoQr = '';
      for (let intento = 0; intento < 5; intento++) {
        codigoQr = codigoQrDe(
          turno.fecha,
          turno.inicio,
          textoAleatorio(6, ALFABETO_QR),
        );
        if (!codigosQr.has(codigoQr)) break;
        if (intento === 4)
          throw new Error(
            'No se pudo generar un código QR único; volvé a ejecutar el comando.',
          );
      }
      if (codigosQr.has(codigoQr))
        throw new Error(
          'Se generó un código QR duplicado; volvé a ejecutar el comando.',
        );
      codigosQr.add(codigoQr);
      if (turno.estado === 'ausente')
        ausenciasPorUsuario.set(
          usuario.id,
          (ausenciasPorUsuario.get(usuario.id) ?? 0) + 1,
        );

      return {
        id: nuevoId('res'),
        turnoId: `tur-${turno.espacioId}-${turno.fecha.replaceAll('-', '')}-${turno.inicio.slice(0, 2)}`,
        espacioId: turno.espacioId,
        usuarioId: usuario.id,
        fecha: turno.fecha,
        inicio: turno.inicio,
        cantidadPersonas: turno.cantidadPersonas,
        codigoQr,
        estado: turno.estado,
        ingresoEn: turno.ingresoEn,
        creadaEn: turno.creadaEn,
        ocupacion: turno.ocupacion,
      };
    });

    await dataSource.transaction(async (manager) => {
      const usuariosTx = manager.getRepository(UsuarioEntidad);
      const reservasTx = manager.getRepository(ReservaEntidad);
      if (usuariosNuevos.length) await usuariosTx.insert(usuariosNuevos);
      for (const [usuarioId, ausencias] of ausenciasPorUsuario) {
        const usuario = usuarios.find((item) => item.id === usuarioId);
        if (!usuario)
          throw new Error(`No se encontró el usuario ficticio ${usuarioId}.`);
        await usuariosTx.update(
          { id: usuarioId },
          { ausencias: usuario.ausencias + ausencias },
        );
      }
      for (let indice = 0; indice < reservas.length; indice += TAMANO_LOTE) {
        await reservasTx.insert(reservas.slice(indice, indice + TAMANO_LOTE));
      }
    });

    console.log(
      `Listo: se agregaron ${reservas.length} reservas ficticias y ${usuariosNuevos.length} cuentas nuevas (sin contraseñas compartidas).`,
    );
    const estados = reservas.reduce<Record<string, number>>(
      (conteo, reserva) => {
        conteo[reserva.estado] = (conteo[reserva.estado] ?? 0) + 1;
        return conteo;
      },
      {},
    );
    console.log(
      `Período: ${desde} a ${hasta}. Estados: ${JSON.stringify(estados)}`,
    );
  } finally {
    await app.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(
    `No se pudo cargar el dataset ficticio: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
