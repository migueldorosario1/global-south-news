import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || 'https://sua-url-supabase.supabase.co';
const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || 'sua-chave-anonima';

const supabase = createClient(supabaseUrl, supabaseKey);

export default function OpenComments({ postUrl }) {
  const [comments, setComments] = useState([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchComments();
  }, [postUrl]);

  async function fetchComments() {
    setLoading(true);
    
    // Fallback caso as variáveis de ambiente não existam ainda
    if (supabaseUrl.includes('sua-url-supabase')) {
      setError('Banco de dados (Supabase) aguardando configuração. Os comentários em breve estarão ativados.');
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('comentarios')
      .select('*')
      .eq('post_url', postUrl)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Erro ao buscar comentários:', error);
      setError('Erro ao carregar comentários do banco de dados.');
    } else {
      setComments(data || []);
      setError(null);
    }
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !message.trim()) return;

    setSubmitting(true);
    
    if (supabaseUrl.includes('sua-url-supabase')) {
        setTimeout(() => {
            setComments([...comments, { id: Date.now(), nome: name, mensagem: message, created_at: new Date().toISOString() }]);
            setName('');
            setMessage('');
            setSubmitting(false);
        }, 500);
        return;
    }

    const { data, error } = await supabase
      .from('comentarios')
      .insert([
        { post_url: postUrl, nome: name, mensagem: message }
      ])
      .select();

    if (error) {
      console.error('Erro ao inserir comentário:', error);
      alert('Houve um erro ao enviar seu comentário. Tente novamente mais tarde.');
    } else if (data) {
      setComments([...comments, data[0]]);
      setName('');
      setMessage('');
    }
    setSubmitting(false);
  }

  function formatDate(isoString) {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('pt-BR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  return (
    <div className="open-comments-section" style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '2px solid rgba(0,0,0,0.1)' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: '#111' }}>Comentários</h2>
      
      {error && <div style={{ background: '#fff3cd', color: '#856404', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>{error}</div>}
      
      <div className="comments-list" style={{ marginBottom: '2rem' }}>
        {loading ? (
          <p>Carregando comentários...</p>
        ) : comments.length === 0 && !error ? (
          <p style={{ color: '#666', fontStyle: 'italic' }}>Seja o primeiro a comentar nesta matéria.</p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="comment-card" style={{ background: '#f9f9f9', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <strong style={{ color: '#0052D4' }}>{comment.nome}</strong>
                <span style={{ fontSize: '0.8rem', color: '#888' }}>{formatDate(comment.created_at)}</span>
              </div>
              <p style={{ margin: 0, color: '#333', lineHeight: 1.5, whiteSpace: 'pre-wrap', fontFamily: 'system-ui, sans-serif' }}>{comment.mensagem}</p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ background: '#f4f7fb', padding: '1.5rem', borderRadius: '12px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem' }}>Deixe seu comentário (Aberto)</h3>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="name" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Seu Nome</label>
          <input 
            type="text" 
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Ex: João da Silva"
            style={{ width: '100%', padding: '0.8rem', borderRadius: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="message" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Mensagem</label>
          <textarea 
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            placeholder="Escreva sua opinião sobre a matéria..."
            rows={4}
            style={{ width: '100%', padding: '0.8rem', borderRadius: '6px', border: '1px solid #ccc', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>
        <button 
          type="submit" 
          disabled={submitting}
          style={{ 
            background: '#0052D4', 
            color: 'white', 
            padding: '0.8rem 1.5rem', 
            border: 'none', 
            borderRadius: '6px', 
            fontWeight: 'bold', 
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.7 : 1
          }}
        >
          {submitting ? 'Enviando...' : 'Publicar Comentário'}
        </button>
      </form>
    </div>
  );
}
