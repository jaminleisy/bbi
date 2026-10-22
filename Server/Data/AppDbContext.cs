using BenBotInventory.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace BenBotInventory.Server.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<PartType> PartTypes => Set<PartType>();
    public DbSet<Seller> Sellers => Set<Seller>();
    public DbSet<CpuSocket> CpuSockets => Set<CpuSocket>();
    public DbSet<PcieGen> PcieGens => Set<PcieGen>();
    public DbSet<RamType> RamTypes => Set<RamType>();
    public DbSet<Location> Locations => Set<Location>();
    public DbSet<Condition> Conditions => Set<Condition>();
    public DbSet<Part> Parts => Set<Part>();
    public DbSet<Computer> Computers => Set<Computer>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<Wage> Wages => Set<Wage>();
    public DbSet<ComputerShare> ComputerShares => Set<ComputerShare>();
    public DbSet<BuildNote> BuildNotes => Set<BuildNote>();
    public DbSet<PartPlaceholder> PartPlaceholders => Set<PartPlaceholder>();
    public DbSet<PartImage> PartImages => Set<PartImage>();
    public DbSet<MessengerThread> MessengerThreads => Set<MessengerThread>();
    public DbSet<MessengerMessage> MessengerMessages => Set<MessengerMessage>();
    public DbSet<MessengerAttachment> MessengerAttachments => Set<MessengerAttachment>();
    public DbSet<MessengerOutbox> MessengerOutbox => Set<MessengerOutbox>();
    public DbSet<MessengerRule> MessengerRules => Set<MessengerRule>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<User>().ToTable("Users");
        modelBuilder.Entity<PartType>().ToTable("PartTypes");
        modelBuilder.Entity<Seller>().ToTable("Sellers");
        modelBuilder.Entity<CpuSocket>().ToTable("CpuSockets");
        modelBuilder.Entity<PcieGen>().ToTable("PcieGens");
        modelBuilder.Entity<RamType>().ToTable("RamTypes");
        modelBuilder.Entity<Location>().ToTable("Locations");
        modelBuilder.Entity<Condition>().ToTable("Conditions");
        modelBuilder.Entity<Part>().ToTable("Parts");
        modelBuilder.Entity<Computer>().ToTable("Computers");
        modelBuilder.Entity<Payment>().ToTable("Payments");
        modelBuilder.Entity<Wage>().ToTable("Wages");
        modelBuilder.Entity<ComputerShare>().ToTable("ComputerShares");
        modelBuilder.Entity<BuildNote>().ToTable("BuildNotes");
        modelBuilder.Entity<PartPlaceholder>().ToTable("PartPlaceholders");
        modelBuilder.Entity<PartImage>().ToTable("PartImages");

        // String FK relationships from Parts to lookup tables (match on strings, no int keys)
        var part = modelBuilder.Entity<Part>();
        part.HasOne<PartType>().WithMany().HasForeignKey(p => p.Type)
            .OnDelete(DeleteBehavior.Restrict);
        part.HasOne<Seller>().WithMany().HasForeignKey(p => p.Seller)
            .OnDelete(DeleteBehavior.Restrict).IsRequired(false);
        part.HasOne<CpuSocket>().WithMany().HasForeignKey(p => p.CpuSocket)
            .OnDelete(DeleteBehavior.Restrict).IsRequired(false);
        part.HasOne<PcieGen>().WithMany().HasForeignKey(p => p.PcieGen)
            .OnDelete(DeleteBehavior.Restrict).IsRequired(false);
        part.HasOne<RamType>().WithMany().HasForeignKey(p => p.RamType)
            .OnDelete(DeleteBehavior.Restrict).IsRequired(false);
        part.HasOne<Location>().WithMany().HasForeignKey(p => p.Location)
            .OnDelete(DeleteBehavior.Restrict).IsRequired(false);
        part.HasOne<Condition>().WithMany().HasForeignKey(p => p.Condition)
            .OnDelete(DeleteBehavior.Restrict).IsRequired(false);
        part.HasOne<User>().WithMany().HasForeignKey(p => p.TestedUserId)
            .OnDelete(DeleteBehavior.Restrict).IsRequired(false);
        part.HasOne(p => p.Computer).WithMany(c => c.Parts).HasForeignKey(p => p.ComputerId)
            .OnDelete(DeleteBehavior.SetNull).IsRequired(false);

        var computer = modelBuilder.Entity<Computer>();
        computer.HasOne<Location>().WithMany().HasForeignKey(c => c.Location)
            .OnDelete(DeleteBehavior.Restrict).IsRequired(false);
        computer.HasOne<User>().WithMany().HasForeignKey(c => c.AddedUserId)
            .OnDelete(DeleteBehavior.Restrict).IsRequired(false);
        computer.HasOne<User>().WithMany().HasForeignKey(c => c.BuilderUserId)
            .OnDelete(DeleteBehavior.Restrict).IsRequired(false);

        modelBuilder.Entity<Payment>()
            .HasOne(p => p.Computer).WithMany(c => c.Payments).HasForeignKey(p => p.ComputerId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Wage>()
            .HasOne<User>().WithMany().HasForeignKey(w => w.BuilderUserId)
            .OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<Wage>()
            .HasOne(w => w.Computer).WithMany(c => c.Wages).HasForeignKey(w => w.ComputerId)
            .OnDelete(DeleteBehavior.SetNull).IsRequired(false);

        modelBuilder.Entity<ComputerShare>()
            .HasOne<User>().WithMany().HasForeignKey(s => s.BuilderUserId)
            .OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<ComputerShare>()
            .HasOne(s => s.Computer).WithMany(c => c.Shares).HasForeignKey(s => s.ComputerId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<BuildNote>()
            .HasOne(n => n.Computer).WithMany(c => c.BuildNotes).HasForeignKey(n => n.ComputerId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<BuildNote>()
            .HasOne<User>().WithMany().HasForeignKey(n => n.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<PartPlaceholder>()
            .HasOne(p => p.Computer).WithMany(c => c.Placeholders).HasForeignKey(p => p.ComputerId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<PartPlaceholder>()
            .HasOne<PartType>().WithMany().HasForeignKey(p => p.Type)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<PartImage>()
            .HasOne(i => i.Part).WithMany(p => p.Images).HasForeignKey(i => i.PartId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<PartImage>()
            .Property(i => i.Data).HasColumnType("varbinary(max)");

        modelBuilder.Entity<MessengerThread>().ToTable("MessengerThreads");
        modelBuilder.Entity<MessengerMessage>().ToTable("MessengerMessages");
        modelBuilder.Entity<MessengerAttachment>().ToTable("MessengerAttachments");
        modelBuilder.Entity<MessengerOutbox>().ToTable("MessengerOutbox");
        modelBuilder.Entity<MessengerRule>().ToTable("MessengerRules");

        modelBuilder.Entity<MessengerThread>()
            .HasIndex(t => t.FbThreadId).IsUnique();
        modelBuilder.Entity<MessengerThread>()
            .HasOne(t => t.Computer).WithMany().HasForeignKey(t => t.ComputerId)
            .OnDelete(DeleteBehavior.SetNull).IsRequired(false);

        modelBuilder.Entity<MessengerMessage>()
            .HasOne(m => m.Thread).WithMany(t => t.Messages).HasForeignKey(m => m.ThreadId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<MessengerMessage>()
            .HasIndex(m => new { m.ThreadId, m.ExternalId }).IsUnique();

        modelBuilder.Entity<MessengerAttachment>()
            .HasOne(a => a.Message).WithMany(m => m.Attachments).HasForeignKey(a => a.MessageId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<MessengerAttachment>()
            .Property(a => a.Data).HasColumnType("varbinary(max)");

        modelBuilder.Entity<MessengerOutbox>()
            .HasOne(o => o.Thread).WithMany().HasForeignKey(o => o.ThreadId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<MessengerOutbox>()
            .HasOne(o => o.Rule).WithMany().HasForeignKey(o => o.RuleId)
            .OnDelete(DeleteBehavior.SetNull).IsRequired(false);
        modelBuilder.Entity<MessengerOutbox>()
            .HasIndex(o => o.Status);
    }
}
