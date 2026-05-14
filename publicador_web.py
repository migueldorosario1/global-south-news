import os
import re
import json
from datetime import datetime
from flask import Flask, render_template_string, request, redirect, url_for, flash, session
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.secret_key = "super_secreto_riocarta_wp"

# Pastas do projeto Astro
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
BLOG_DIR = os.path.join(PROJECT_ROOT, "src", "content", "blog")
HERO_DIR = os.path.join(PROJECT_ROOT, "public", "hero")

os.makedirs(BLOG_DIR, exist_ok=True)
os.makedirs(HERO_DIR, exist_ok=True)

# Credenciais simples (Hardcoded)
ADMIN_USER = "admin"
ADMIN_PASS = "riocarta2026"

LOGIN_TEMPLATE = """
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Log In &lsaquo; Rio Carta — WordPress</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif; background: #f0f0f1; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .login { width: 320px; padding: 8% 0 0; margin: auto; }
        .login h1 { text-align: center; margin-bottom: 25px; }
        .login h1 a { color: #3c434a; text-decoration: none; font-size: 24px; font-weight: 400; }
        .login form { background: #fff; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.13); margin-top: 20px; border: 1px solid #c3c4c7; border-radius: 4px; }
        .login label { font-size: 14px; color: #3c434a; display: block; margin-bottom: 5px; font-weight: 600; }
        .login input[type="text"], .login input[type="password"] { width: 100%; padding: 5px 10px; font-size: 24px; line-height: 1.33333333; border: 1px solid #8c8f94; border-radius: 4px; margin-bottom: 16px; box-sizing: border-box; }
        .login input[type="submit"] { background: #2271b1; border-color: #2271b1; color: #fff; display: inline-block; font-size: 13px; line-height: 2.15384615; min-height: 30px; margin: 0; padding: 0 16px; cursor: pointer; border-radius: 3px; font-weight: 600; width: 100%; }
        .login input[type="submit"]:hover { background: #135e96; border-color: #135e96; }
        .error { background: #fff; border-left: 4px solid #d63638; padding: 12px; margin-bottom: 20px; box-shadow: 0 1px 1px 0 rgba(0,0,0,.1); font-size: 14px; }
    </style>
</head>
<body class="login-action-login wp-core-ui locale-pt-br">
    <div class="login">
        <h1><a href="#">Rio Carta Editor</a></h1>
        {% if error %}
            <div class="error"><p>{{ error }}</p></div>
        {% endif %}
        <form method="POST">
            <p>
                <label>Nome de usuário</label>
                <input type="text" name="username" required>
            </p>
            <p>
                <label>Senha</label>
                <input type="password" name="password" required>
            </p>
            <p class="submit">
                <input type="submit" value="Acessar">
            </p>
        </form>
    </div>
</body>
</html>
"""

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Adicionar novo post &lsaquo; Rio Carta — WordPress</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif; background: #f0f0f1; margin: 0; color: #3c434a; }
        #wpadminbar { height: 32px; background: #1d2327; color: #f0f0f1; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
        #wpadminbar a { color: #f0f0f1; text-decoration: none; margin-right: 15px; }
        #wpadminbar a:hover { color: #72aee6; }
        #adminmenuwrap { position: fixed; width: 160px; height: 100%; background: #1d2327; top: 32px; padding-top: 10px; }
        #adminmenuwrap a { display: block; color: #f0f0f1; padding: 10px 15px; text-decoration: none; font-size: 14px; }
        #adminmenuwrap a:hover, #adminmenuwrap a.active { background: #2271b1; color: #fff; }
        #wpcontent { margin-left: 160px; padding: 20px; padding-top: 50px; }
        h1.wp-heading-inline { font-size: 23px; font-weight: 400; margin: 0 0 20px; display: inline-block; }
        .postbox-container { display: flex; gap: 20px; }
        .main-content { flex: 1; }
        .sidebar { width: 280px; }
        .postbox { background: #fff; border: 1px solid #c3c4c7; margin-bottom: 20px; box-shadow: 0 1px 1px rgba(0,0,0,.04); }
        .postbox-header { padding: 10px 15px; border-bottom: 1px solid #c3c4c7; font-weight: 600; font-size: 14px; }
        .inside { padding: 15px; }
        input[type="text"], textarea { width: 100%; padding: 5px 8px; border: 1px solid #8c8f94; border-radius: 4px; box-sizing: border-box; font-size: 14px; }
        #title { padding: 10px; font-size: 20px; font-weight: 600; border: 1px solid #c3c4c7; margin-bottom: 15px; box-shadow: inset 0 1px 2px rgba(0,0,0,.07); }
        textarea { height: 400px; resize: vertical; margin-top: 15px; }
        .button-primary { background: #2271b1; border-color: #2271b1; color: #fff; text-decoration: none; text-shadow: none; display: inline-block; font-size: 13px; line-height: 2.15384615; min-height: 30px; margin: 0; padding: 0 10px; cursor: pointer; border-width: 1px; border-style: solid; border-radius: 3px; white-space: nowrap; font-weight: 600; width: 100%; }
        .button-primary:hover { background: #135e96; }
        label { display: block; margin-bottom: 5px; font-weight: 600; font-size: 13px; }
        input[type="file"] { margin-bottom: 10px; font-size: 13px; }
        .notice { background: #fff; border-left: 4px solid #00a32a; padding: 10px 15px; margin-bottom: 20px; box-shadow: 0 1px 1px 0 rgba(0,0,0,.1); }
    </style>
</head>
<body>
    <div id="wpadminbar">
        <div>
            <a href="#">🏠 Rio Carta</a>
            <a href="#">+ Novo</a>
        </div>
        <div>
            <a href="#">Olá, Colaborador</a>
            <a href="/logout">Sair</a>
        </div>
    </div>
    <div id="adminmenuwrap">
        <a href="#">Painel</a>
        <a href="#" class="active">Posts</a>
        <a href="#">Mídia</a>
        <a href="#">Páginas</a>
        <a href="#">Aparência</a>
    </div>
    <div id="wpcontent">
        <h1 class="wp-heading-inline">Adicionar novo post</h1>
        
        {% with messages = get_flashed_messages() %}
          {% if messages %}
            {% for message in messages %}
              <div class="notice"><p>{{ message }}</p></div>
            {% endfor %}
          {% endif %}
        {% endwith %}

        <form method="POST" enctype="multipart/form-data">
            <div class="postbox-container">
                <div class="main-content">
                    <input type="text" name="title" id="title" required placeholder="Adicionar título">
                    
                    <div class="postbox">
                        <div class="postbox-header">Descrição (Linha Fina / SEO)</div>
                        <div class="inside">
                            <input type="text" name="description" required placeholder="Resumo do artigo em 1-2 frases">
                        </div>
                    </div>

                    <textarea name="content" required placeholder="Comece a escrever a matéria aqui..."></textarea>
                </div>
                
                <div class="sidebar">
                    <div class="postbox">
                        <div class="postbox-header">Publicar</div>
                        <div class="inside">
                            <button type="submit" class="button-primary">Publicar</button>
                        </div>
                    </div>
                    
                    <div class="postbox">
                        <div class="postbox-header">Categorias / Bairros</div>
                        <div class="inside">
                            <label>Tags (separadas por vírgula)</label>
                            <input type="text" name="tags" required placeholder="Ex: rio-de-janeiro, centro">
                        </div>
                    </div>

                    <div class="postbox">
                        <div class="postbox-header">Autor</div>
                        <div class="inside">
                            <input type="text" name="author" required placeholder="Nome do autor">
                        </div>
                    </div>

                    <div class="postbox">
                        <div class="postbox-header">Imagem destacada</div>
                        <div class="inside">
                            <input type="file" name="heroImage" accept="image/*" required>
                        </div>
                    </div>
                </div>
            </div>
        </form>
    </div>
</body>
</html>
"""

def sanitize_slug(text):
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        user = request.form.get("username")
        pwd = request.form.get("password")
        if user == ADMIN_USER and pwd == ADMIN_PASS:
            session['logged_in'] = True
            return redirect(url_for("index"))
        else:
            return render_template_string(LOGIN_TEMPLATE, error="A senha fornecida para esse usuário está incorreta.")
    return render_template_string(LOGIN_TEMPLATE)

@app.route("/logout")
def logout():
    session.pop('logged_in', None)
    return redirect(url_for("login"))

@app.route("/", methods=["GET", "POST"])
def index():
    if not session.get('logged_in'):
        return redirect(url_for("login"))

    if request.method == "POST":
        title = request.form["title"]
        description = request.form["description"]
        tags_raw = request.form["tags"]
        author = request.form["author"]
        content = request.form["content"]
        file = request.files.get("heroImage")

        tags = [t.strip().lower().replace(" ", "-") for t in tags_raw.split(",") if t.strip()]
        
        if file and file.filename:
            filename = secure_filename(file.filename).lower()
            image_path = os.path.join(HERO_DIR, filename)
            file.save(image_path)
            hero_image_url = f"/hero/{filename}"
        else:
            hero_image_url = ""

        slug = sanitize_slug(title)
        pub_date = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        md_filename = f"{slug}.md"
        md_filepath = os.path.join(BLOG_DIR, md_filename)
        
        md_content = f"---"
        md_content += f"\ntitle: \"{title}\""
        md_content += f"\ndescription: \"{description}\""
        md_content += f"\npubDate: \"{pub_date}\""
        md_content += f"\ntags: {json.dumps(tags)}"
        md_content += f"\nheroImage: \"{hero_image_url}\""
        md_content += f"\nauthor: \"{author}\""
        md_content += f"\n---\n\n{content}\n"
        
        with open(md_filepath, "w", encoding="utf-8") as f:
            f.write(md_content)
            
        flash(f"Post publicado. (Arquivo Markdown gerado: {md_filename})")
        return redirect(url_for("index"))

    return render_template_string(HTML_TEMPLATE)

if __name__ == "__main__":
    print("Iniciando o Painel Administrativo do Rio Carta na porta 5000...")
    print(f"Credenciais Padrão -> Usuário: {ADMIN_USER} | Senha: {ADMIN_PASS}")
    print("Acesse no navegador: http://localhost:5000")
    app.run(host="127.0.0.1", port=5000)
