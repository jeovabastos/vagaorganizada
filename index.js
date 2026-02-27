import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import Stripe from 'stripe';

// Inicializações com excessão do "app.use(express.json())"
dotenv.config()
const app = express();
app.use(cors({
  origin: 'https://vagaorganizadafrontendvite.vercel.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.static('public'));
const upload = multer({ storage: multer.memoryStorage() });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABE_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const FRONTEND_DOMAIN = 'https://vagaorganizadafrontendvite.vercel.app'



// A rota do Webhook precisa do corpo bruto para validar a assinatura do Stripe
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        // O STRIPE_WEBHOOK_SECRET você pega no painel do Stripe
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Quando o pagamento é concluído com sucesso
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.client_reference_id; // O ID que você enviou no checkout!

        // Aqui você usa a SERVICE_ROLE_KEY para atualizar o banco sem restrições de RLS
        const { error } = await supabaseAdmin
            .from('perfis')
            .update({ plano_ativo: true })
            .eq('id', userId);

        if (error) console.error("Erro ao ativar plano:", error);
    }

    res.json({ received: true });
});
app.use(express.json())




// rota para cadastrar recrutador e fazer o checkout
app.post('/create-checkout-session', async (req, res) => {
  try {
    // Extraímos os dados que o frontend enviou no corpo (body) da requisição
    const { email, password } = req.body;

    // 1. Criar recrutador no Supabase
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          email: email,
          plano_ativo: false
        },
      },
    })
    if (error) throw error;

    // 2. Criar Sessão no Stripe
    const session = await stripe.checkout.sessions.create({
      customer_email: email, 
      client_reference_id: data.user.id, 
      payment_method_types: ['card'],
      line_items: [{ price: 'price_1T4kdrEakH8NLS3DI6nhoJCO', quantity: 1 }],
      mode: 'payment',
      success_url: `${FRONTEND_DOMAIN}/success`,
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});



// rota para recrutador cadastrar vaga vindo da página de success.html








// REFAZER PARA QUE A O ID DA VAGA CERTA SEJA USADA AQUI
// rota para candidato enviar curriculo 
app.post('/upload', upload.single('curriculo'), async (req, res) => {
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
      // from: 'onboarding@resend.dev' || 'mail.vagaorganizada.com', // Ou seu domínio verificado
      from: 'onboarding@mail.vagaorganizada.com',
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