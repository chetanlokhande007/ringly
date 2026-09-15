using Microsoft.EntityFrameworkCore;
using Ringly.Api.Data;
using Ringly.Api.Security;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<ICredentialProtector, AesGcmCredentialProtector>();

var connectionString = builder.Configuration.GetConnectionString("Default");
if (!string.IsNullOrWhiteSpace(connectionString))
{
    builder.Services.AddDbContext<RinglyDbContext>(o => o.UseSqlServer(connectionString));
}

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}

// --- Static React app (published into wwwroot) --------------------------
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseRouting();
app.UseAuthorization();

// --- API routing --------------------------------------------------------
app.MapControllers();

// Unknown API paths must 404 as API, never as HTML.
app.Map("/api/{**rest}", () => Results.NotFound(new { error = "Not found" }));

// --- Client-side routing: any other unknown route serves index.html so the
//     React router can handle deep links and page refreshes.
app.MapFallbackToFile("index.html");

app.Run();
