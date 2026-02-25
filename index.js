// api/index.js
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import Stripe from 'stripe';

dotenv.config()

const app = express();
app.use(cors({
  origin: "*"
}))
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage() });

// Inicializações
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

Stripe(process.env.STRIPE_PUBLIC_KEY)

const YOUR_DOMAIN = 'http://127.0.0.1:5500';

app.post('/create-checkout-session', async (req, res) => {
  const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
        price: 'price_1T4kdrEakH8NLS3DI6nhoJCO',
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${YOUR_DOMAIN}/success.html`,
  });

  res.redirect(303, session.url);
});

app.post('/api/upload', upload.single('curriculo'), async (req, res) => {
  try {
    const file = req.file;
    const { nome, sobrenome, emailRecrutador } = req.body;

    // 1. Upload para o Supabase
    const { data, error: uploadError } = await supabase.storage
      .from('curriculos')
      .upload(`public/${file.originalname}`, file.buffer, {
        contentType: 'application/pdf',
        upsert: true 
      });

    if (uploadError) throw uploadError;

    // 2. Pegar a URL pública (que você usará no corpo do e-mail ou para baixar)
    const { data: { publicUrl } } = supabase.storage.from('curriculos').getPublicUrl(data.path);

    // 3. Preparar o anexo para o Resend
    // Como o arquivo já está em 'file.buffer' (graças ao Multer), 
    // não precisamos nem baixar do Supabase agora! Usamos o que já temos na memória.
    await resend.emails.send({
      from: 'onboarding@resend.dev' || 'mail.vagaorganizada.com', // Ou seu domínio verificado
      to: emailRecrutador || 'jbastos.im@gmail.com',
      subject: `Novo Currículo: ${file.originalname}`,
      html: `
        <p>Olá, o candidato <strong>${nome} ${sobrenome}</strong> enviou um currículo.</p>
        <p>Você também pode acessá-lo aqui: <a href="${publicUrl}">Link Direto</a></p>
      `,
      attachments: [
        {
          filename: file.originalname,
          content: file.buffer, // O Resend aceita o buffer diretamente do Multer
        },
      ],
    });

    return res.status(200).json({ message: 'E-mail enviado e arquivo salvo!', url: publicUrl });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao processar envio.' });
  }
});

export default app;