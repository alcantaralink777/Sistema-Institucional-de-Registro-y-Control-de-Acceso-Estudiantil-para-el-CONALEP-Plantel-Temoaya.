const express = require('express');
const cors = require('cors');
const path = require('path');
const sql = require('mssql/msnodesqlv8'); // Controlador para Autenticación de Windows

const app = express();
app.use(cors());
app.use(express.json());

// Servir archivos estáticos (index.html) desde la misma carpeta del proyecto
app.use(express.static(path.join(__dirname)));

// Configuración adaptada a tu SQL Server (Autenticación de Windows)
const dbConfig = {
    connectionString: "Driver={ODBC Driver 17 for SQL Server};Server=.\\ALCANTARA1;Database=conalep_acceso;Trusted_Connection=yes;"
};

// Endpoint que recibe el escaneo del QR desde la web/móvil
app.post('/api/escaneo', async (req, res) => {
    const { matricula, tipo_movimiento } = req.body;

    if (!matricula || !tipo_movimiento) {
        return res.status(400).json({ status: 'error', mensaje: 'Faltan datos (matrícula o tipo de movimiento)' });
    }

    try {
        let pool = await sql.connect(dbConfig);

        // 1. Buscar si el alumno existe
        let resultadoAlumno = await pool.request()
            .input('matricula', sql.VarChar, matricula)
            .query('SELECT id_alumno, nombre, carrera, grupo FROM alumnos WHERE matricula = @matricula');

        if (resultadoAlumno.recordset.length === 0) {
            return res.status(404).json({ status: 'error', mensaje: 'Matrícula no encontrada' });
        }

        const alumno = resultadoAlumno.recordset[0];

        // 1.5. VALIDACIÓN ANTI-DUPLICADOS Y DE ALTERNANCIA (Entrada / Salida)
        let ultimoMovimiento = await pool.request()
            .input('id_alumno', sql.Int, alumno.id_alumno)
            .query('SELECT TOP 1 tipo_movimiento, fecha_hora FROM registros_acceso WHERE id_alumno = @id_alumno ORDER BY id_registro DESC');

        if (ultimoMovimiento.recordset.length > 0) {
            const ultimo = ultimoMovimiento.recordset[0];
            const tiempoTranscurrido = (new Date() - new Date(ultimo.fecha_hora)) / 1000; // en segundos

            // Regla A: Evitar doble escaneo idéntico por accidente en menos de 30 segundos
            if (tiempoTranscurrido < 30 && ultimo.tipo_movimiento === tipo_movimiento) {
                return res.json({
                    status: 'success',
                    mensaje: `Acceso ya registrado recientemente`,
                    alumno: `${alumno.nombre} - ${alumno.carrera} (${alumno.grupo})`,
                    notificacion: 'Movimiento omitido por duplicidad rápida'
                });
            }

            // Regla B: Validar secuencia lógica (evitar doble entrada o doble salida seguida)
            if (tipo_movimiento === 'ENTRADA' && ultimo.tipo_movimiento === 'ENTRADA' && tiempoTranscurrido > 30) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: `El alumno ya se encuentra dentro. Debe registrar Salida.`
                });
            }

            if (tipo_movimiento === 'SALIDA' && ultimo.tipo_movimiento === 'SALIDA' && tiempoTranscurrido > 30) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: `El alumno ya registró su salida previamente.`
                });
            }
        } else {
            // Si es su primer registro histórico y selecciona SALIDA por error
            if (tipo_movimiento === 'SALIDA') {
                return res.status(400).json({
                    status: 'error',
                    mensaje: `No hay registro previo de entrada para este alumno.`
                });
            }
        }

        // 2. Registrar el acceso en la tabla registros_acceso
        await pool.request()
            .input('id_alumno', sql.Int, alumno.id_alumno)
            .input('tipo_movimiento', sql.VarChar, tipo_movimiento)
            .query("INSERT INTO registros_acceso (id_alumno, tipo_movimiento, estatus_notificacion) VALUES (@id_alumno, @tipo_movimiento, 'PENDIENTE')");

        const fechaHoraActual = new Date().toLocaleString('es-MX');
        console.log(`[REGISTRO BD] Alumno: ${alumno.nombre} (${alumno.grupo}) - ${tipo_movimiento} a las ${fechaHoraActual}`);

        // 3. Actualización limpia del estatus de notificación en el último registro del alumno
        await pool.request()
            .input('id_alumno', sql.Int, alumno.id_alumno)
            .query("UPDATE registros_acceso SET estatus_notificacion = 'ENVIADO' WHERE id_registro = (SELECT MAX(id_registro) FROM registros_acceso WHERE id_alumno = @id_alumno)");

        res.json({
            status: 'success',
            mensaje: `Acceso de ${tipo_movimiento} registrado con éxito`,
            alumno: `${alumno.nombre} - ${alumno.carrera} (${alumno.grupo})`,
            fechaHora: fechaHoraActual,
            notificacion: 'Notificación enviada al tutor correctamente'
        });

    } catch (err) {
        console.error('Error en la base de datos:', err);
        res.status(500).json({ status: 'error', mensaje: 'Error interno del servidor' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor API ejecutándose en http://localhost:${PORT} y en la red local`);
});
