const express = require('express');
const cors = require('cors');
const sql = require('mssql/msnodesqlv8'); // Controlador para Autenticación de Windows

const app = express();
app.use(cors());
app.use(express.json());

// Configuración adaptada a tu SQL Server (Autenticación de Windows)

const config = {
    server: '.\\ALCANTARA1', // Tu instancia local
    database: 'conalep_acceso',
    driver: 'msnodesqlv8',
    options: {
        trustedConnection: true, // Autenticación de Windows
        enableArithAbort: true
    }
};
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

        // 2. Registrar el acceso en la tabla registros_acceso
        await pool.request()
            .input('id_alumno', sql.Int, alumno.id_alumno)
            .input('tipo_movimiento', sql.VarChar, tipo_movimiento)
            .query("INSERT INTO registros_acceso (id_alumno, tipo_movimiento, estatus_notificacion) VALUES (@id_alumno, @tipo_movimiento, 'PENDIENTE')");

        const fechaHoraActual = new Date().toLocaleString('es-MX');
        console.log(`[REGISTRO BD] Alumno: ${alumno.nombre} (${alumno.grupo}) - ${tipo_movimiento} a las ${fechaHoraActual}`);

        // 3. Simular actualización del envío de notificación
        await pool.request()
            .input('id_alumno', sql.Int, alumno.id_alumno)
            .query("UPDATE TOP (1) registros_acceso SET estatus_notificacion = 'ENVIADO' WHERE id_alumno = @id_alumno ORDER BY id_registro DESC");

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
app.listen(PORT, () => {
    console.log(`Servidor API ejecutándose en http://localhost:${PORT}`);
});
