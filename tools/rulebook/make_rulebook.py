# Builds the Cold Steel Squadron Captain's Rulebook PDF with ReportLab (pip install reportlab pillow).
#   python3 tools/rulebook/make_rulebook.py            -> docs/Cold_Steel_Squadron_Rulebook_<BUILD>.pdf
# The figures are screenshots of the game and diagrams from the v1.3.0 rulebook; retake screenshots when screens change.
# Update BUILD and the text below with each rules change, and check every number against game.js.
import sys, os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
                                Image, PageBreak, KeepTogether, NextPageTemplate, Flowable, CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents
from PIL import Image as PILImage

BUILD = 'v1.13.0'
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FIG = os.path.join(HERE, 'figures') + '/'
ASSETS = os.path.join(ROOT, 'assets') + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'docs', f'Cold_Steel_Squadron_Rulebook_{BUILD}.pdf')

NAVY = colors.HexColor('#12294A')
GOLD = colors.HexColor('#B8862B')
INK = colors.HexColor('#1E2633')
DIM = colors.HexColor('#5B6573')
LINE = colors.HexColor('#C9CED6')
ZEBRA = colors.HexColor('#F2F4F7')
NOTE_BG = colors.HexColor('#FBF3E2')
WARN_BG = colors.HexColor('#FBE6E4')
WARN_EDGE = colors.HexColor('#B23A2E')
BLUE = colors.HexColor('#2C6AA0')
RED = colors.HexColor('#A8322A')
ORANGE = colors.HexColor('#C2661F')

W, H = letter
M = 54

# ---------------- styles ----------------
body = ParagraphStyle('body', fontName='Helvetica', fontSize=9.5, leading=13, textColor=INK, spaceAfter=5)
small = ParagraphStyle('small', parent=body, fontSize=8, leading=10.5, textColor=DIM, spaceAfter=4)
caption = ParagraphStyle('caption', parent=small, alignment=TA_CENTER, spaceBefore=2, spaceAfter=8)
h1 = ParagraphStyle('h1', keepWithNext=1, fontName='Times-Bold', fontSize=20, leading=24, textColor=NAVY, spaceBefore=10, spaceAfter=8)
h2 = ParagraphStyle('h2', keepWithNext=1, fontName='Helvetica-Bold', fontSize=12, leading=15, textColor=NAVY, spaceBefore=8, spaceAfter=4)
h3 = ParagraphStyle('h3', keepWithNext=1, fontName='Helvetica-Bold', fontSize=10.5, leading=13, textColor=NAVY, spaceBefore=6, spaceAfter=3)
bullet = ParagraphStyle('bullet', parent=body, leftIndent=12, bulletIndent=2, spaceAfter=3)
num = ParagraphStyle('num', parent=body, leftIndent=14, bulletIndent=0, spaceAfter=3)
cell = ParagraphStyle('cell', fontName='Helvetica', fontSize=8.5, leading=10.5, textColor=INK)
cellb = ParagraphStyle('cellb', parent=cell, fontName='Helvetica-Bold')
cellh = ParagraphStyle('cellh', parent=cell, fontName='Helvetica-Bold', textColor=colors.white)
note_title = ParagraphStyle('nt', fontName='Helvetica-Bold', fontSize=9.5, leading=12, textColor=GOLD, spaceAfter=2)
note_body = ParagraphStyle('nb', parent=body, fontSize=9, leading=12, spaceAfter=0)

def P(t, s=body): return Paragraph(t, s)
def B(t): return Paragraph(t, bullet, bulletText='•')
def N(i, t): return Paragraph(t, num, bulletText=f'{i}.')
def bullets(*items): return [B(t) for t in items]
def steps(*items): return [N(i+1, t) for i, t in enumerate(items)]

class H1(Paragraph):
    def __init__(self, text): super().__init__(text, h1)
def H3(text): return Paragraph(text, h3)
class H2(Paragraph):
    def __init__(self, text): super().__init__(text, h2)

def note(title, text, warn=False):
    inner = [P(title, ParagraphStyle('x', parent=note_title, textColor=WARN_EDGE if warn else GOLD))]
    inner += [P(t, note_body) for t in (text if isinstance(text, list) else [text])]
    t = Table([[inner]], colWidths=[W-2*M])
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1), WARN_BG if warn else NOTE_BG),
        ('LINEBEFORE',(0,0),(0,-1),3, WARN_EDGE if warn else GOLD),
        ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
    return KeepTogether([Spacer(1,4), t, Spacer(1,6)])

def table(rows, widths, header=True, first_bold=True, keep=True):
    data = []
    for r_i, r in enumerate(rows):
        row = []
        for c_i, c in enumerate(r):
            st = cellh if (header and r_i == 0) else (cellb if (first_bold and c_i == 0) else cell)
            row.append(c if isinstance(c, Flowable) else Paragraph(str(c), st))
        data.append(row)
    total = W - 2*M
    cw = [total*w for w in widths]
    t = Table(data, colWidths=cw, repeatRows=1 if header else 0)
    style = [('GRID',(0,0),(-1,-1),0.4,LINE),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
             ('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)]
    if header: style += [('BACKGROUND',(0,0),(-1,0),NAVY)]
    for i in range(1 if header else 0, len(data)):
        if (i % 2 == 0): style.append(('BACKGROUND',(0,i),(-1,i),ZEBRA))
    t.setStyle(TableStyle(style))
    return KeepTogether([t, Spacer(1, 8)]) if keep else t

def img(path, width, cap=None, maxh=None):
    pw, ph = PILImage.open(path).size
    h = width*ph/pw
    if maxh and h > maxh: width, h = maxh*pw/ph, maxh
    im = Image(path, width=width, height=h)
    parts = [Spacer(1,3), im]
    if cap: parts.append(P(cap, caption))
    else: parts.append(Spacer(1,6))
    return KeepTogether(parts)

def img_row(items, height):
    # items: [(path, caption)], all scaled to the same height, side by side
    cells, caps, widths = [], [], []
    for path, cap in items:
        pw, ph = PILImage.open(path).size
        w = height*pw/ph
        cells.append(Image(path, width=w, height=height)); caps.append(P(cap, caption)); widths.append(w+8)
    t = Table([cells, caps], colWidths=widths)
    t.setStyle(TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),2),('RIGHTPADDING',(0,0),(-1,-1),2)]))
    return KeepTogether([Spacer(1,3), t, Spacer(1,4)])

# ---------------- page templates ----------------
def interior(c, doc):
    c.saveState()
    c.setStrokeColor(GOLD); c.setLineWidth(0.8); c.line(M, H-40, W-M, H-40)
    c.setFont('Times-Italic', 8.5); c.setFillColor(DIM)
    c.drawString(M, H-35, "Cold Steel Squadron — Captain's Rulebook")
    c.drawRightString(W-M, H-35, f'Build {BUILD}')
    c.setFont('Helvetica', 8.5); c.drawCentredString(W/2, 30, str(doc.page))
    c.restoreState()

def cover(c, doc):
    c.saveState()
    c.setFillColor(colors.HexColor('#0A1A33')); c.rect(0, 0, W, H, fill=1, stroke=0)
    art = ASSETS + 'title-screen.jpg'; pw, ph = PILImage.open(art).size
    ah = W*ph/pw
    c.drawImage(art, 0, H-ah-70, width=W, height=ah)
    c.setFillColor(colors.HexColor('#E8C15A')); c.setFont('Helvetica-Bold', 10)
    c.drawCentredString(W/2, H-45, 'A D20 TABLETOP-STYLE NAVAL WARGAME')
    y = H-ah-70-60
    c.setFillColor(colors.white); c.setFont('Times-Bold', 34); c.drawCentredString(W/2, y, "CAPTAIN'S RULEBOOK")
    c.setFillColor(colors.HexColor('#E8C15A')); c.setFont('Times-Italic', 15); c.drawCentredString(W/2, y-28, 'Turrets, torpedoes, and cold steel')
    c.setStrokeColor(colors.HexColor('#E8C15A')); c.setLineWidth(1); c.line(W/2-120, y-44, W/2+120, y-44)
    c.setFillColor(colors.HexColor('#C9D3E2')); c.setFont('Helvetica', 10)
    c.drawCentredString(W/2, y-64, 'Against the computer, or another admiral online')
    c.drawCentredString(W/2, 50, f'Based on game build {BUILD}')
    c.restoreState()

def back(c, doc):
    c.saveState()
    c.drawImage(FIG+'back-cover.jpg', 0, 0, width=W, height=H)
    c.setFillColor(colors.white); c.setFont('Times-Bold', 26); c.drawCentredString(W/2, H/2+20, 'COLD STEEL SQUADRON')
    c.setFillColor(colors.HexColor('#E8C15A')); c.setFont('Times-Italic', 13); c.drawCentredString(W/2, H/2-4, f"Captain's Rulebook • build {BUILD}")
    c.setFillColor(colors.HexColor('#C9D3E2')); c.setFont('Helvetica', 9)
    c.drawCentredString(W/2, H/2-40, 'Print on US Letter, single-sided. The interior pages are light on ink; only the covers are dark.')
    c.restoreState()

class Doc(BaseDocTemplate):
    def __init__(self, fn):
        super().__init__(fn, pagesize=letter, leftMargin=M, rightMargin=M, topMargin=54, bottomMargin=48,
                         title="Cold Steel Squadron — Captain's Rulebook", author='Cold Steel Squadron',
                         subject=f"Captain's Rulebook for game build {BUILD}")
        fr = Frame(M, 48, W-2*M, H-54-48, id='f', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        full = Frame(0, 0, W, H, id='full')
        self.addPageTemplates([PageTemplate('cover', [full], onPage=cover), PageTemplate('body', [fr], onPage=interior),
                               PageTemplate('back', [full], onPage=back)])
    def afterFlowable(self, f):
        if isinstance(f, H1):
            self.notify('TOCEntry', (0, f.getPlainText(), self.page))

story = []
story += [Spacer(1,1), NextPageTemplate('body'), PageBreak()]

# ---------------- contents ----------------
story.append(P('Contents', h1))
toc = TableOfContents()
toc.levelStyles = [ParagraphStyle('toc', fontName='Helvetica', fontSize=10.5, leading=17, textColor=INK)]
toc.dotsMinLevel = 0
story.append(toc)
story.append(Spacer(1, 14))
story.append(note('How to use this book', [
    "This rulebook explains how a battle works from the first click to the last shot, and ends with reference tables you can keep "
    f"beside you while you play. It describes build {BUILD} of the game, and every number in it was checked against that build.",
    "Distances are in inches (\"): the Annihilation board is 1,200\" by 800\"; Breakthrough and King of the Hill are fought on a smaller "
    "800\" by 800\" board. Angles are in degrees. A ship's heading is a compass bearing, with 0° straight up the screen (north) and "
    "90° to the right (east).",
    "<b>New since the last edition (build v1.3.0):</b> the game's new name and title screen; automatic ship names; capture zones in "
    "King of the Hill; online Multiplayer for every battle type, with a phase clock and Orders Completed; the Focus Target special "
    "order; ships blocking line of sight; and the animated phase, Battle Commence, Victory and Defeat banners."]))
story.append(PageBreak())

# ---------------- 1. The Game ----------------
story.append(CondPageBreak(200)); story.append(H1('1. The Game'))
story.append(P("<b>Cold Steel Squadron</b> (formerly <i>Battle Fleet: Pre-Dreadnought</i>) is a d20 tabletop-style naval wargame played on "
    "screen, against the computer or against another admiral online. Two fleets of steel-hulled warships, from nimble Frigates up to "
    "hulking Battleships, meet on an open sea scattered with islands. You steer your ships, point their turrets, trade broadsides, launch "
    "torpedoes and lay mines, and the enemy does the same to you."))
story.append(img_row([(FIG+'old-bridge.jpg', 'The bridge view when a shell lands.'), (FIG+'old-torpedo.jpg', 'A torpedo strike.')], 100))
story.append(CondPageBreak(150)); story.append(H2('Object of the game'))
story.append(P("This is the object of the <b>Annihilation</b> battle. The <b>Breakthrough</b> and <b>King of the Hill</b> battle types have "
    "different objectives, described in Sections 11 and 12.", small))
story += bullets("<b>Win</b> by destroying every enemy ship.",
    "<b>Lose</b> if every one of your ships is destroyed. You may also press <b>Surrender</b> at any time to end the battle as a defeat.",
    "A ship is destroyed when its Structure reaches 0, when a critical hit blows it up, or if it <b>sails off the edge of the board</b> "
    "(it is lost with all hands).")
story.append(CondPageBreak(150)); story.append(H2('The battlefield'))
story += bullets("The sea is <b>1,200\" wide and 800\" tall</b> in Annihilation, and <b>800\" by 800\"</b> in Breakthrough and King of the Hill.",
    "Each battle scatters <b>1 to 5 islands</b> across it, never more than 5% of the board in total. Islands wreck ships that run into "
    "them and block line of sight (see Section 8).",
    "The <b>Sun</b> sits at a random bearing each battle. Aiming a shot into the glare is harder (see Section 6). Its bearing is shown "
    "at the top of the screen.")
story.append(CondPageBreak(150)); story.append(H2('Your opponent'))
story.append(P("In a Skirmish the enemy admiral is controlled by the computer. It fields <b>the same number of each ship class as you</b>, "
    "armed with the standard loadout (Autoguns, Cannons and Torpedoes), and every one of its ships carries a name. It aims its turrets "
    "at the nearest enemy, and if another ship or an island is in the way it shoots at the nearest enemy it can see instead. It steers "
    "to line up torpedo shots, lays mines from its Frigates, steers clear of islands and torpedo lanes, plots its biggest ships first so "
    "the rest steer round them (it does not sail into its own fleet, even when turning about), and fires whenever it has a target. It "
    "uses All Ahead Full when your fleet is far away, now and then Focus Target when an enemy is just out of turret range, and, rarely, "
    "Full Reverse Stop. (It does not use Course Adjustment.)"))
story.append(P("In <b>Multiplayer</b> the other fleet is commanded by another player over the internet; see Section 13."))

# ---------------- 2. Your Fleet ----------------
story.append(PageBreak())
story.append(CondPageBreak(200)); story.append(H1('2. Your Fleet'))
story.append(CondPageBreak(150)); story.append(H2('Ship classes'))
story.append(P("There are six classes. Light ships are fast and carry torpedoes or mines; the cruisers and the Battleship trade speed for "
    "armor, structure and a great many guns."))
story.append(img(FIG+'old-ships.jpg', W-2*M-40))
story.append(table([
    ['Stat','Frigate','Destroyer','Light Cruiser','Medium Cruiser','Heavy Cruiser','Battleship'],
    ['Structure','10','15','15','20','30','45'],
    ['Shields (prow, port, starboard)','10 each','10 each','10 each','10 each','10 each','10 each'],
    ['Armor: prow / starb. / port / stern','15 / 8 / 8 / 6','15 / 12 / 12 / 6','20 / 20 / 20 / 10','25 / 22 / 22 / 15','30 / 25 / 25 / 15','45 / 35 / 35 / 15'],
    ['Base movement','30"','25"','25"','25"','25"','20"'],
    ['Top speed cap','90" (3x)','75" (3x)','62.5" (2.5x)','62.5" (2.5x)','62.5" (2.5x)','60" (3x)'],
    ['Turning (per move)','60°','45°','45°','45°','45°','40°'],
    ['Min. turn distance (first move)','4"','8"','8"','8"','10"','10"'],
    ['Hull length x width','11" x 4"','16" x 5"','21" x 6"','21" x 7"','22" x 8"','25" x 8"'],
    ['Gunnery (lower is better)','13','13','12','12','12','10'],
    ['Turret traverse per turn','90°','60°','60°','60°','60°','60°'],
    ['Broadside slots (each side)','1','2','3','3','4','6'],
    ['Turret slots','2','2','4','4','6','6'],
    ['Torpedo tubes','2','3','1','0','0','0'],
    ['Mines carried','6','none','none','none','none','none'],
], [0.22,0.13,0.13,0.13,0.13,0.13,0.13]))
story.append(P("Gunnery is the number your d20 roll must beat to hit; the Battleship, at 10, hits most often. Every class has 10 shields on its "
    "prow, port and starboard, none on the stern, regenerating +5 per facing each round.", small))
story.append(CondPageBreak(150)); story.append(H2('Facings, shields, armor and structure'))
story.append(P("Every ship has four <b>facings</b>: prow, starboard, stern and port. Each facing is a 90° quadrant around the hull. Damage is "
    "always applied to the facing that a shot or blast arrives from, and protection is tracked per facing:"))
story += bullets("<b>Shields</b> absorb damage first. A ship has 10 on its prow, port and starboard, and <b>none on the stern</b>. They "
    "regenerate <b>+5 per facing</b> at the start of each of your Movement phases, up to 10.",
    "<b>Armor</b> absorbs next. Each facing has its own armor value. Armor does not regenerate.",
    "<b>Structure</b> is the ship's hull. It takes whatever damage gets past shields and armor, and it never regenerates. At 0 the ship is "
    "destroyed. Hits to Structure may also cause Critical Damage (Section 6).")
story.append(CondPageBreak(150)); story.append(H2('Weapons'))
story.append(img(FIG+'old-weapons.jpg', W-2*M-20))
story.append(table([
    ['Weapon','Mounts in','Range','Damage','Shots per turn','Where it fires'],
    ['Cannon','Turret slots','140"','8','2','25° turret cone'],
    ['Heavy Cannon','Turret slots (Battleship only)','200"','12','1','25° turret cone'],
    ['Autogun','Port / starboard broadside slots','80"','5','2','90° arc on its own side'],
    ['Torpedo','Torpedo tubes','600"','15','2 per tube','7° lane that stops widening at 15"'],
    ['Mine','Laid astern (Frigates only)','goes off within 10"','20','1 per Special Orders','a 10" ring around the mine'],
], [0.13,0.25,0.12,0.09,0.14,0.27]))
story += bullets("A shot from a gun mount is one roll against the target. Each fitted gun can fire <b>2 shots per turn</b> (Cannon, Autogun) or "
    "<b>1</b> (Heavy Cannon). Shots refill at the start of each of your Movement phases.",
    "Guns and torpedoes are not interchangeable: Autoguns go only in the broadside slots; Cannons and Heavy Cannons go only in the turret "
    "slots, and the Heavy Cannon only on the Battleship; Torpedoes go only in the tubes.",
    "<b>Half-rate front and rear fire.</b> A turret shooting at a target that lies in the firing ship's <b>prow or stern quadrant</b> spends "
    "<b>2 shots per mount</b> for each volley instead of 1, so it fires half as often (a mount with one shot left still fires). Heavy Cannons "
    "have only one shot and are unaffected.",
    "An empty mount does nothing. A new fleet comes pre-fitted with an Autogun in every broadside slot, a Cannon in every turret slot and a "
    "Torpedo in every tube.")

# ---------------- 3. Setting up ----------------
story.append(PageBreak())
story.append(CondPageBreak(200)); story.append(H1('3. Setting Up a Battle'))
story.append(img_row([(FIG+'new-title.jpg', 'The title screen: press any key or click.'), (FIG+'new-menu.jpg', 'The Main Menu.')], 150))
story.append(P("The game opens on the <b>Cold Steel Squadron title screen</b>. Press any key, or click or tap anywhere, to go to the "
    "<b>Main Menu</b>, where you pick a game type. <b>Skirmish</b> is a battle against the computer and <b>Multiplayer</b> is a battle against "
    "another player online (Section 13); <b>Campaign</b> and <b>Missions</b> are shown greyed out as \"coming soon\". Choosing Skirmish asks "
    "which battle you want: <b>Annihilation</b> (a straight fight to the last ship, set up as described below), <b>Breakthrough</b> (attackers "
    "run VIP ships to an exit while defenders try to stop them; see Section 11) or <b>King of the Hill</b> (two fleets fight over a series of "
    "capture zones; see Section 12). The Back to Menu button on the fleet builder returns you to the menu."))
story.append(P("An Annihilation battle is set up in four short screens before the first round begins. Each of the last three has a Back "
    "button. (Breakthrough and King of the Hill have their own setups, in Sections 11 and 12.)"))
story += steps("<b>Build your fleet.</b> The six classes sit side by side in a row of cards, each with the ship's large picture and a – / + "
    "counter underneath. Choose how many of each you want (0–5 each; every class starts at 0 and you need at least one ship). The "
    "enemy fields the same number of each class.",
    "<b>Fitment.</b> Every ship's slots come pre-filled: Autoguns in the broadsides, Cannons in the turrets (Heavy Cannons are never "
    "fitted by default) and Torpedoes in the tubes. Change any of it by clicking an empty or filled slot and then a weapon, or by dragging "
    "a weapon onto a slot. You can also <b>name each ship</b>. Unfitted mounts won't fire. Reset All to Default restores the standard loadout.",
    "<b>Formation.</b> Drag your ships around a 100\" by 100\" square to decide how they start the battle relative to one another.",
    "<b>Choose your heading.</b> Pick North, South, East or West. Both fleets start on opposite sides of the board facing each other along that line.")
story.append(P("If you go Back to the fleet picker and leave the numbers unchanged, your fitment and formation are kept; change the numbers "
    "and the fleet is rebuilt.", small))
story.append(note('Ship names', "When the battle starts, every ship you left unnamed is given a name from the game's list of ship names "
    "(Tempest, Warspite, Hotspur and so on), and every enemy ship is named the same way. No name is used twice in a battle, and a name "
    "you typed yourself always wins. With more than 30 ships in a battle the list runs out, and the extra ships keep a plain label such "
    "as \"Frigate 12\"."))
story.append(note('A contested approach', "The enemy admiral picks a heading at random. If you both pick the same heading, neither fleet faces "
    "the other: instead it is a <b>stern chase</b>. One fleet, chosen at random, is caught about two-thirds of the way across the board, with "
    "the other bearing down on it from behind."))
story.append(P("The battle then begins: a <b>Battle Commence</b> banner sweeps across the board, followed by the Movement banner for "
    "Round 1, with you to move."))

# ---------------- 4. Round at a glance ----------------
story.append(CondPageBreak(200)); story.append(H1('4. The Round at a Glance'))
story.append(P("A battle is played in <b>rounds</b>, and every round has three phases in the same order. You act in each phase, and the enemy "
    "acts at the moments marked below."))
gl = ParagraphStyle('gl', parent=cell, textColor=colors.white, alignment=TA_CENTER, fontSize=8.3, leading=10.5)
glh = ParagraphStyle('glh', parent=gl, fontName='Helvetica-Bold', fontSize=10, leading=13)
glance = Table([[ [P('1. MOVEMENT', glh), P('Plan every ship\'s move<br/>Pick turret targets<br/><b>End Movement Phase:</b><br/>enemy moves, fleets sweep,<br/>turrets swing, torpedoes strike', gl)],
                  [P('2. FIRING', glh), P('Queue volleys per ship<br/>Confirm Targeting<br/><b>Commence Firing:</b><br/>both sides fire at once<br/><b>End Firing Phase:</b> critical checks', gl)],
                  [P('3. SPECIAL ORDERS', glh), P('ONE order per ship: Torpedo Attack,<br/>Lay Mine, Course Adjustment,<br/>All Ahead Full, Full Reverse Stop<br/>or Focus Target<br/><b>End Special Orders:</b> torpedoes launch, mines drop', gl)] ]],
               colWidths=[(W-2*M-20)/3]*3)
glance.setStyle(TableStyle([('BACKGROUND',(0,0),(0,0),NAVY),('BACKGROUND',(1,0),(1,0),BLUE),('BACKGROUND',(2,0),(2,0),RED),
    ('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),9),('LINEAFTER',(0,0),(1,0),6,colors.white)]))
story.append(KeepTogether([glance, P('next round: shields regenerate, guns refill and repairs are rolled as the next Movement phase begins', caption)]))
story += bullets("<b>Movement</b> is where you plan every ship's course and choose each turret's target. Nothing moves until you press <b>End "
    "Movement Phase</b>; then the enemy plans its moves, and all ships sail together.",
    "<b>Firing</b> is where each ship queues volleys from its guns. Your shots and the enemy's are resolved together when you press <b>Commence "
    "Firing</b>. Ships with no target in range and arc do not need to be confirmed; only ships that can shoot must. Critical hits are rolled "
    "when you press <b>End Firing Phase</b>.",
    "<b>Special Orders</b> gives every ship one order for the round: launch torpedoes, lay a mine, adjust its course, or order All Ahead Full, "
    "Full Reverse Stop or Focus Target for the next round. They all take effect when you press <b>End Special Orders Phase</b>.")
story.append(P("<b>Phase banners.</b> As each phase begins, an animated banner (Movement, Shooting or Special Orders) sweeps across the "
    "middle of the board over a navy and gold stripe, then sweeps away after about two and a half seconds. It never blocks the screen: you "
    "can start giving orders while it plays."))
story.append(img(FIG+'new-banner.jpg', 330, 'The Movement banner sweeping across the board at the start of a round.'))
story.append(P("<b>Start of each of your Movement phases:</b> your ships' shields regenerate (+5 per facing), every gun refills its shots for the "
    "turn, and ships suffering Critical Damage roll for repairs. Torpedoes launched in an earlier Special Orders phase strike at the end of "
    "the Movement phase, after everyone has finished moving."))
story.append(note('Skipping steps', "You are never forced to fire. If you have nothing to shoot at, press <b>Skip Firing Phase</b> and the round "
    "moves straight on to Special Orders (the enemy still fires). In Special Orders, a ship you leave alone simply does nothing. (In Multiplayer "
    "these buttons are replaced by Orders Completed; see Section 13.)"))

# ---------------- 5. Movement ----------------
story.append(CondPageBreak(200)); story.append(H1('5. The Movement Phase'))
story.append(CondPageBreak(150)); story.append(H2('The fleet list'))
story.append(P("The draggable stat window opens as a <b>stacked list of every ship under your command</b>. Click a ship's row to expand its stat "
    "window; click it again to close it. <b>Only one ship can be open at a time.</b>"))
story += bullets("While a ship is open you can click it on the map to move or control it, but you <b>cannot click your other ships on the map</b>. "
    "This stops you grabbing the wrong ship in a crowded fleet. (Clicking an enemy ship to set a turret target still works.)",
    "While no ship is open, clicking one of your ships on the map opens it. There is no box-select or shift-click: you command one ship at a time.",
    "To switch ships, close the open one or click another row in the list.")
story.append(CondPageBreak(150)); story.append(H2('Plotting a course'))
story.append(P("With a ship open, click and drag it on the map. <b>How far you drag sets its speed. Which way you drag sets one course-correction "
    "turn</b> toward wherever you drop it, up to the ship's turning stat (Frigate 60°, Battleship 40°, all others 45°). A dashed ghost "
    "shows exactly where the ship will end up. When you are happy, press <b>Confirm Movement</b>. Each ship moves once per Movement phase; a "
    "confirmed ship cannot be moved again that round."))
story.append(P("If your intended spot cannot be reached in one turn, the ship turns as hard as it can toward it and covers whatever ground that "
    "leaves. A hard turn also costs extra distance from the move: it covers less net ground than a gentle one."))
story.append(CondPageBreak(150)); story.append(H2('Turning: the MSMD'))
story.append(img(FIG+'old-msmd.jpg', W-2*M-30))
story.append(P("A ship cannot begin its turn the moment it starts moving. It must first hold its heading for its <b>MSMD</b> (Minimum Ship Movement "
    "Distance): 45% of the distance it actually travelled last Movement phase, or on its very first move its fixed minimum turn distance. The "
    "plotted course shows this as an orange stretch; it turns solid white once the ship is allowed to turn."))
story.append(CondPageBreak(150)); story.append(H2('Momentum'))
story.append(table([['','Rule'],
    ['Minimum move this turn','50% of the distance covered last turn (no minimum on a ship\'s first move).'],
    ['Maximum move this turn','Starts at the ship\'s base Movement. After every move it <b>rises by 25% of the distance just covered</b>, up to the ship\'s top '
     'speed cap (its base movement times its top-speed multiplier: Frigate 90", Destroyer 75", Light Cruiser 62.5", Medium and Heavy Cruiser 62.5", '
     'Battleship 60"). Run fast for long and the ceiling keeps climbing, then levels off.']], [0.25,0.75]))
story.append(note('Do not leave the board', "A ship that ends its move outside the board is lost with all hands. Watch your edges, especially at high speed.", warn=True))
story.append(CondPageBreak(150)); story.append(H2('Turret targeting'))
story.append(P("Turrets are aimed during Movement, in the same stat window you use to plot the move. Every ship's window has a <b>Turret Target</b> box:"))
story += steps("Pick an enemy from the drop-down (it shows each ship's distance), or click an enemy ship on the map while your ship is open.",
    "Press <b>Confirm Target</b>. A dashed red line now joins your ship to its target. <b>Edit Target</b> unlocks it again if you change your mind.",
    "Press <b>End Movement Phase</b>. While the fleets sail, each turret cone swings round toward its target, ending up as close to on-target as the "
    "turret can manage, judged from where both ships finish their moves.")
story += bullets("A turret can rotate by at most the ship's <b>Turret Traverse</b> each turn: Frigate 90°, every other class 60°.",
    "At the start of a battle every turret is trained along its ship's heading. A turret with <b>no confirmed target turns with the hull</b> as the "
    "ship turns, so it keeps pointing the way it did relative to the bow. Once a target is confirmed it swings toward the target instead.",
    "Targets stay locked from round to round. In any later Movement phase use Edit Target to change one. A target that sinks clears itself.",
    "A ship on <b>Focus Target</b> (Section 7.6) cannot change its turret target this round: the box shows the ship it is locked on.",
    "If you pick a target but forget to confirm it, you are warned before the phase ends, because that turret will not aim.",
    "A ship with no turrets fitted shows \"No turrets fitted\"; its broadside guns need no aiming.")
story.append(note('When the turret cannot reach', "If the turret has swung as far as it can and the cone still does not cover the target, a small "
    "gold arrow comes off the side of the cone, pointing toward the red line, with the words <b>\"X Degrees of rotation off of target\"</b>. X is how "
    "much further the turret would still have to turn to bring the line inside the cone. It is a cue to use a broadside, move, or retarget next turn."))
story.append(CondPageBreak(150)); story.append(H2('Crippled ships'))
story.append(P("A ship hit by Critical Damage (Section 6) loses some control during the next Movement phase. A <b>dead-in-the-water</b> ship takes no "
    "movement or turning orders: it coasts straight ahead at 50% of the distance it last moved, and a blue arrow on the map shows its drift. Its "
    "broadside guns still fire, but its <b>turret is frozen</b> (it cannot aim, and cannot make turret attacks) and it can issue <b>no Special Orders</b> "
    "(no torpedoes, mines, Course Adjustment, All Ahead Full, Full Reverse Stop or Focus Target). Everything returns to normal once the engines are "
    "repaired. A <b>helm-jammed</b> ship is stuck in a full-lock turn to the left or right, and an orange arrow shows the direction it is stuck going. "
    "Its turrets and guns still work."))
story.append(CondPageBreak(150)); story.append(H2('Ramming and collisions'))
story.append(P("Every hull is a long, narrow rectangle along its heading, and all ships sail at once during the 2-second sweep. If two hulls overlap "
    "at any moment of the sweep it is a <b>collision</b>, even if the two ships would have ended the move apart. Friendly ships collide too. The "
    "earliest contact counts, and a ship can be in only one collision per Movement phase (All Ahead Full moves are checked the same way)."))
story += bullets("<b>Ram:</b> one ship's bow runs into another ship's side or stern. The rammer's distance this move sets the impact. Running into the "
    "back of a ship sailing the same way counts only the difference in distance covered.",
    "<b>Head-on:</b> both bows meet. The impact is both ships' distances added together.",
    "<b>Sideswipe:</b> a glancing scrape along the flanks. Half the usual impact.",
    "<b>Impact</b> = distance ÷ 5, rounded up (minimum 1).",
    "Each ship takes a share of the impact in proportion to the <b>other</b> ship's size: Frigate 1, Destroyer 1.5, Light Cruiser 2, Medium Cruiser 3, "
    "Heavy Cruiser 4, Battleship 6. Each takes at least 1. A Frigate ramming a Battleship at 90\" makes an impact of 18: the Frigate takes about "
    "15, the Battleship about 3.",
    "Impact damage <b>ignores shields</b>. It goes into the armor of the facing that was struck, then Structure, and a hit that reaches Structure "
    "triggers a Critical Damage check like any other.",
    "<b>Both ships stop</b> where they touch and lose the rest of their planned move. Each ship's momentum is lost completely, so next turn it can "
    "turn at once and sail off at its ordinary base speed.",
    "The two hulls are then <b>pushed apart</b> along the line between them, leaving a few inches of clearance so neither is left pinned to the "
    "other. The smaller ship is knocked back much further; the larger one barely moves. A ship is never pushed onto an island or off the board. "
    "Once clear, a ship may back off and ram again on a later turn.")

# ---------------- 6. Firing ----------------
story.append(PageBreak())
story.append(CondPageBreak(200)); story.append(H1('6. The Firing Phase'))
story.append(CondPageBreak(150)); story.append(H2('Firing arcs'))
story.append(img(FIG+'old-arcs.jpg', W-2*M-30))
story += bullets("<b>Broadside guns</b> (Autoguns) fire into a 90° arc on their own side: from 45° to 135° off the bow on the starboard side, "
    "and from 225° to 315° on the port side. Nothing broadside fires straight ahead or straight astern.",
    "<b>Turrets</b> (Cannons, Heavy Cannons) fire into a 25° cone around wherever the turret is currently pointing. That is why targeting matters.",
    "Open any of your ships to see its firing arcs painted red on the map. During Movement, a blue fan shows how far the ship can go.")
story.append(CondPageBreak(150)); story.append(H2('Line of sight'))
story.append(P("A gun can only fire at a target it can see. Two things block the line:"))
story += bullets("<b>Islands.</b> A shot cannot reach a target with land directly in the way, even if the target is inside the arc and range. A "
    "selected ship's arcs are shaded dark where an island hides the view.",
    "<b>Other ships.</b> A shot cannot pass through another ship's hull. If any ship, <b>friend or foe</b>, sits on the straight line between the "
    "shooter and its target, the shot is blocked. Manoeuvre for a clear line, or pick a different target.")
story.append(P("A blocked target is flagged in the Fire Control target list (\"island blocks LOS\" or \"ship blocks LOS\"). A gun that tries to fire "
    "at a blocked target holds its fire and keeps its shots, and the log says what is in the way. Torpedoes are different: they run along their "
    "lane and strike the first ship in it (Section 7.1)."))
story.append(CondPageBreak(150)); story.append(H2('Queueing and firing'))
story += steps("Open a ship. In its <b>Fire Control</b> box choose a weapon group (port broadside, starboard broadside, or turrets), choose a target, "
    "and queue a <b>volley</b>. A volley is one shot from every fitted gun in that group that still has shots left. You can queue as many volleys "
    "as the guns have shots (at most 2).",
    "<b>Half-rate turrets.</b> If the target is in your prow or stern quadrant, each turret volley costs 2 of a mount's shots, so a Cannon fires one "
    "volley instead of two. A mount with only one shot left still fires.",
    "Press <b>Confirm Targeting</b> for that ship. The row of circles under each group shows shots still available (filled) and spent (empty).",
    "When every ship that has a target is confirmed, press <b>Commence Firing</b> (it stays greyed out if nothing can shoot; if a ship with a target "
    "has not confirmed, the game asks first). Your shots and the enemy's resolve at the same time. A ship reduced to 0 Structure still fires in the "
    "exchange; sinkings are marked when you press <b>End Firing Phase</b>.")
story += bullets("A shot at a target outside its arc or with its line of sight blocked does not fire at all. A shot at a target out of range is spent "
    "and automatically misses.")
story.append(CondPageBreak(150)); story.append(H2('When a ship is destroyed'))
story.append(P("Any ship reduced to 0 Structure by the end of the Firing phase (after All Ahead Full moves, and after critical damage is rolled) is "
    "lost. Every ship lost that phase explodes on the map: an explosion plays <b>twice</b> over its sprite, stern to bow. The ship then leaves the "
    "board and a Firing Window opens beside where it stood, showing it going down. When the windows close, the Special Orders phase begins. Ships "
    "lost in the Movement phase (to a torpedo, or by leaving the board) are removed without the animation."))
story.append(CondPageBreak(150)); story.append(H2('Hitting: the d20 roll'))
story.append(P("For every shot, roll 1d20 and add the modifiers below. <b>If the total is greater than the firing ship's Gunnery (10, 12 or 13), it "
    "hits.</b> Modifiers are added together. (They adjust the roll, not the Gunnery stat, so closer always means easier.)"))
story.append(table([['Situation','Modifier'],
    ['Target within 1/4 of the weapon\'s maximum range','+2'],
    ['Target within 1/2 of the weapon\'s maximum range','+1'],
    ['Target beyond 3/4 of the weapon\'s maximum range','–1'],
    ['Shot aimed within 15° of the Sun','–5'],
    ['Target is aground (see Section 8)','+5'],
    ['Gun shot at a ship on Full Reverse Stop (not torpedoes or mines)','+3']], [0.82,0.18], first_bold=False))
story.append(table([['d20 roll needed to hit','+2 (¼ range)','+1 (½ range)','0','–1 (beyond ¾)','–5 (sun)','+5 (aground)'],
    ['Battleship (Gunnery 10)','9+ (60%)','10+ (55%)','11+ (50%)','12+ (45%)','16+ (25%)','6+ (75%)'],
    ['Cruisers (Gunnery 12)','11+ (50%)','12+ (45%)','13+ (40%)','14+ (35%)','18+ (15%)','8+ (65%)'],
    ['Destroyer / Frigate (Gunnery 13)','12+ (45%)','13+ (40%)','14+ (35%)','15+ (30%)','19+ (10%)','9+ (60%)']],
    [0.25,0.125,0.125,0.125,0.125,0.125,0.125]))
story.append(P("A ship on <b>Focus Target</b> doubles its turret range (Section 7.6), so the range bands above are measured against the doubled range.", small))
story.append(CondPageBreak(150)); story.append(H2('Damage'))
story.append(img(FIG+'old-damage.jpg', W-2*M))
story.append(P("Once a shot hits (or a torpedo or mine connects), its damage is taken from the <b>facing it strikes</b>, working inward: that facing's "
    "shield, then that facing's armor, then Structure. Damage never moves to a different facing. Two things bypass part of this:"))
story += bullets("<b>Mines</b> ignore shields; their damage goes straight to armor.",
    "A <b>grounded</b> ship's shields absorb nothing, so every attack skips straight to armor.")
story.append(note('Worked example: two Cannon hits', ["Your Cruiser (Gunnery 12) fires a Cannon (range 140\") at a Frigate 110\" away. That is beyond 3/4 of "
    "the range (105\"), so the modifier is –1. You roll 14: 14 – 1 = 13, which beats 12. Hit. The shot arrives on the Frigate's prow: the prow "
    "shield (10) absorbs all 8 damage and drops to 2.",
    "The second Cannon shot also hits. The prow shield's last 2 points absorb 2 damage; the remaining 6 go into the prow armor (15 becomes 9). "
    "Structure is untouched. At the start of the Frigate's next Movement phase its prow shield regenerates to 5; the armor stays at 9."]))
story.append(CondPageBreak(150)); story.append(H2('Critical Damage'))
story.append(P("Damage that gets all the way through to <b>Structure</b> may cripple the ship. When the Firing phase ends (End Firing Phase), every ship "
    "that took a Structure hit rolls a <b>D20</b> against a target number that depends on how much of that facing's armor is left; the more battered "
    "the armor, the easier it is to cripple the ship."))
story.append(img(FIG+'old-crit.jpg', W-2*M))
story.append(table([['Armor left (the struck facing)','D20 needed for a critical hit'],['75% or more','16 or higher'],['50% or more','11 or higher'],
    ['25% or more','6 or higher'],['Under 25%','any roll']], [0.5,0.5], first_bold=False))
story.append(table([['D6','Result','What happens'],
    ['1','Catastrophic explosion','The ship is destroyed outright.'],
    ['2–5','Dead in the water','The ship has no power. In the next Movement phase it takes no orders and coasts straight ahead at 50% of the distance '
     'it last moved. A blue arrow shows the drift. Broadsides still fire; the turret is frozen and no Special Orders can be given.'],
    ['6','Steering jammed','Roll a D2: 1 = stuck turning left, 2 = stuck turning right. The ship makes a full-lock turn in that direction, starting at '
     'once. An orange arrow shows the way it is stuck.']], [0.08,0.24,0.68]))
story += bullets("The condition lasts through the <b>next full Movement phase</b>. After that, at the start of each following Movement phase, the ship "
    "rolls a <b>D2</b>: on a 2 it is repaired and moves normally again.",
    "If a ship suffers <b>several critical hits at once</b>, the lowest D6 counts. A ship that is already crippled keeps the worse of its old and new condition.",
    "Small pop-up cards beside the ship show each roll, and the ship carries a \"DEAD IN WATER\" or \"HELM JAMMED L/R\" label until repaired.")
story.append(CondPageBreak(150)); story.append(H2('What the windows show'))
story.append(P("Every shot, launch, hit and miss opens a small <b>Firing Window</b> next to the ships involved, playing a short animation: guns firing "
    "from the shooter, and a bridge-view impact or splash at the target. The log at the bottom of the screen records the numbers."))
story.append(img(FIG+'old-windows.jpg', W-2*M-60))

# ---------------- 7. Special Orders ----------------
story.append(PageBreak())
story.append(CondPageBreak(200)); story.append(H1('7. The Special Orders Phase'))
story.append(P("After the Firing phase, every ship gets exactly <b>one</b> Special Order for the round, and no ship may do more than one:"))
story.append(table([['Order','Who','What it does'],
    ['Torpedo Attack','Ships with torpedoes ready (Frigate, Destroyer, Light Cruiser)','Launch one or more torpedoes down the ship\'s lane (Section 7.1).'],
    ['Lay Mine','Frigates with mines left','Drop a mine just astern (Section 7.2).'],
    ['Course Adjustment','Any ship','Rotate in place, with no change to speed or position (Section 7.3).'],
    ['All Ahead Full','Any ship not crippled or aground','Next round it makes an extra move instead of shooting (Section 7.4).'],
    ['Full Reverse Stop','Any ship not aground','Next round it only coasts, and is easier to hit (Section 7.5).'],
    ['Focus Target','Ships with turrets, not crippled or aground','Next round its turrets reach twice as far at one chosen enemy, but it holds course and speed (Section 7.6).']],
    [0.2,0.32,0.48]))
story.append(P("Open a ship and press the button for the order you want. <b>Back</b> returns to the picker so you can choose a different order. An "
    "order is locked in once you confirm it. Nothing actually happens until you press <b>End Special Orders Phase</b>: that is the moment confirmed "
    "torpedoes launch, confirmed mines drop, and their animations play. Then the next round begins."))
story.append(CondPageBreak(150)); story.append(H2('7.1 Torpedo Attack'))
story.append(P("A torpedo is a fire-and-forget weapon. You do not aim it and you do not roll to hit when you launch it. Frigates have 2 tubes, "
    "Destroyers 3, the Light Cruiser 1; the Medium and Heavy Cruisers and the Battleship have none."))
story += steps("Pick each torpedo the ship should launch: there is one button per torpedo, up to two per ready tube. Press <b>Confirm Launch</b>. "
    "(Edit Launch reopens the choice.) A confirmed launch shows as a lighter \"planned\" lane. Torpedoes that are selected but not confirmed will not launch.",
    "When you end the phase, each torpedo remembers the spot it was launched from and the lane it was launched into. The lane is drawn on the map "
    "as a dashed outline: yours in orange, the enemy's in red.",
    "The torpedoes <b>strike at the end of the next Movement phase</b>, after every ship has finished moving. Plenty of time to dodge, if you can see it coming.")
story.append(img(FIG+'old-lane.jpg', W-2*M))
story.append(H3('The lane'))
story.append(P("The lane runs straight ahead of the ship's prow. It opens out as a <b>7° cone</b> until it is 15\" across (about 123\" from the "
    "ship), then carries on at that same width, as a straight strip, out to the torpedo's full 600\" range."))
story.append(H3('Resolving a torpedo'))
story += steps("A ship that has moved out of the lane by then is safe. So is any ship hidden from the launch point by an island.",
    "Of the ships still inside the lane, the torpedo runs into the <b>one closest to where it was launched</b>. That can be one of your own ships: "
    "friend or foe, so mind your formation. The launching ship itself is never hit.",
    "The torpedo then rolls to connect. The chance is about <b>95% point-blank, falling steadily to 10% at the full 600\" range</b> (see the hit "
    "chances under the lane diagram above). Ships close to the launch point are far more likely to be hit.",
    "A torpedo that connects does <b>15 damage</b>, through shields, then armor, then Structure like any other hit. The Gunnery stat is not used.")
story += bullets("<b>Reloading is per shot.</b> A tube holds two torpedoes. A shot you fire spends the next round reloading; a shot you did not fire "
    "stays ready. So firing one of two leaves the other ready for next round.",
    "<b>Near misses.</b> Every ship the torpedo threatened but did not hit (anyone who was in the lane, or within 5\" of it, either at launch or when "
    "it resolves) gets its own near-miss window, even if the torpedo was never rolled against it.")
story.append(CondPageBreak(150)); story.append(H2('7.2 Lay Mine'))
story.append(P("<b>Frigates only</b>, and each carries 6 mines. Laying a mine is the ship's one Special Order for the round: it cannot also launch a "
    "torpedo or adjust course. Press <b>Lay Mine</b> to stage it, or Cancel to back out. The mine is actually dropped, just off the ship's stern, only "
    "when you press End Special Orders Phase."))
story += bullets("A laid mine sits where it was dropped. A dotted gold ring around it shows the <b>10\" trigger distance</b>.",
    "It goes off when an <b>enemy</b> ship ends a move within 10\" of it. It never harms ships on the side that laid it.",
    "The mine attacks with <b>Gunnery 4 for 20 damage</b>, which ignores shields and goes to armor, then Structure.",
    "A mine is used up when it goes off, whether or not its attack roll connects.",
    "Click any mine on the board to watch it: a Firing Window opens beside it and loops until you click somewhere else.")
story.append(CondPageBreak(150)); story.append(H2('7.3 Course Adjustment'))
story.append(P("Rotate the ship <b>in place</b>, up to <b>half its turning stat</b> either way (Frigate 30°, Battleship 20°, every other class "
    "22.5°), with no change to speed or position. Drag the gold handle out from the bow around to the new heading (it greys out past the limit) "
    "and press <b>Confirm Course</b>; it takes effect immediately. Edit Course lets you change it again before the phase ends. The limit is always "
    "measured from the heading the ship had when the phase began, not from wherever you turned it to. A typical use is nudging a ship's heading so "
    "that a torpedo lane or a broadside points where you expect the enemy to be."))
story.append(CondPageBreak(150)); story.append(H2('7.4 All Ahead Full'))
story.append(P("Choose it in Special Orders and it takes effect in the <b>next round's Firing phase</b>. That ship cannot fire (its Fire Control is off) "
    "but can still be shot at. Instead, while you queue your other ships' shots, drag the ship on the map to plot an <b>extra move</b> and press "
    "<b>Confirm Extra Move</b> (Edit Move changes it). The extra move uses the same momentum limits as an ordinary move, starting from where the ship "
    "now is. It is not made straight away: it happens when you press <b>End Firing Phase</b>, after every shot has been rolled. If the ship is sunk "
    "by those shots it does not move. Commence Firing stays available even if All Ahead Full ships are the only ones left. Critical damage is rolled "
    "after the extra moves."))
story.append(CondPageBreak(150)); story.append(H2('7.5 Full Reverse Stop'))
story.append(P("Choose it in Special Orders and in the <b>next Movement phase</b> the ship makes no move of its own: it coasts straight ahead for "
    "<b>25% of its last move</b> and cannot turn. Gun shots (cannons, heavy cannons, autoguns) fired at it in the Firing phase after that get <b>+3 to "
    "hit</b>, because it is slow and easy to hit. Torpedoes and mines are not affected."))
story.append(CondPageBreak(150)); story.append(H2('7.6 Focus Target'))
_fw, _fh = PILImage.open(FIG+'new-focus.jpg').size
foc = Image(FIG+'new-focus.jpg', width=170, height=170*_fh/_fw)
ft_text = [P("For ships with turrets that are not crippled or aground. Press <b>Focus Target</b>, choose one enemy ship from the list, and press "
    "<b>Confirm Order</b>. For the next round:"),
    B("<b>Turret range is doubled</b> in the next Firing phase: a Cannon reaches 280\" instead of 140\", a Heavy Cannon 400\" instead of 200\". The "
      "range bands for the to-hit roll (Section 6) are measured against the doubled range."),
    B("The turrets may fire <b>only at the chosen ship</b>. In Fire Control, Fire Turrets is greyed out for any other target. Broadside guns are not "
      "affected: they keep their normal range and may fire at anyone."),
    B("In the next Movement phase the ship <b>cannot turn and cannot pick a new turret target</b>. Its move is plotted for you: straight ahead, "
      "<b>the same distance it moved last time</b> (a ship that did not move stays put). Its turret stays locked on the chosen ship."),
    B("The ship returns to normal as soon as that Firing phase is over. If the chosen ship is sunk first, the turrets have nothing to fire at that round.")]
ft = Table([[ft_text, foc]], colWidths=[W-2*M-185, 185])
ft.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(0,0),10)]))
story.append(ft)
story.append(P("The fleet list shows a \"focus target\" tag on the ship while the order is in force, and the log announces which ship it is locked on. "
    "Critical damage that cripples the ship still overrides the plotted move.", small))

# ---------------- 8. Islands ----------------
story.append(CondPageBreak(200)); story.append(H1('8. Islands and Grounding'))
story.append(img(FIG+'old-islands.jpg', 300))
story.append(P("Every battle has 1 to 5 islands, irregular in shape, placed at random so they never overlap one another, and covering no more than 5% "
    "of the board together."))
story.append(CondPageBreak(150)); story.append(H2('Running aground'))
story += bullets("If a ship's plotted course would carry it into an island, the ship <b>stops dead the instant it makes landfall</b>. The ghost preview "
    "shows exactly where.",
    "Contact does <b>one third of the ship's maximum Structure</b> in damage, bypassing shields and armor (Frigate 3, Destroyer 5, Light Cruiser 5, "
    "Medium Cruiser 7, Heavy Cruiser 10, Battleship 15). The ship is now <b>grounded</b>.",
    "A grounded ship <b>cannot move at all</b> the following turn.",
    "The turn after that, you can <b>re-float</b> it: drag it up to 30\" from where it grounded (shown as a dashed circle) to any position and "
    "heading. After that it moves normally again.")
story.append(note('Aground means exposed', "While a ship is aground (frozen or waiting to be re-floated) every attack against it gets <b>+5 on the roll "
    "to hit</b>, and its shields absorb nothing: damage skips straight to armor. Both effects end the moment it is re-floated.", warn=True))
story.append(CondPageBreak(150)); story.append(H2('Islands and fire'))
story.append(P("Islands also block line of sight for gunfire and for torpedoes (Sections 6 and 7). A ship sitting behind an island cannot be shot at "
    "from the far side of it, and cannot shoot back that way either. Remember that ships block gunfire too (Section 6)."))

# ---------------- 9. Ending ----------------
story.append(CondPageBreak(200)); story.append(H1('9. Ending the Battle'))
story.append(P("This section covers Annihilation. Breakthrough and King of the Hill end differently; see Sections 11 and 12.", small))
story += bullets("<b>Victory:</b> every enemy ship is destroyed. <b>Defeat:</b> every one of your ships is destroyed. <b>Surrender:</b> you can press "
    "Surrender at any time; it counts as a defeat.",
    "When the battle is decided, a <b>Victory</b> or <b>Defeat</b> banner sweeps across the board (Victory also when your opponent surrenders or "
    "leaves an online game).",
    "A <b>battle summary</b> then appears. It lists both fleets, how each ship ended, and for each ship a table of every weapon's shots fired, hits, "
    "hit percentage and damage dealt.",
    "Return to Main Menu starts a new battle.")

# ---------------- 10. Reading the screen ----------------
story.append(PageBreak())
story.append(CondPageBreak(200)); story.append(H1('10. Reading the Screen'))
story.append(CondPageBreak(150)); story.append(H2('Controls'))
story.append(table([['Action','How'],
    ['Leave the title screen','Press any key, or click or tap anywhere.'],
    ['Open a ship','Click its row in the fleet list, or click it on the map when no ship is open. Click the row, or the ship on the map, again to close '
     'it. Only one ship is open at a time.'],
    ['Zoom','Scroll wheel.'],
    ['Pan the map','Right-click and drag.'],
    ['Move or re-float a ship','Drag it (Movement phase). Dragging also sets the Course Adjustment handle in Special Orders.'],
    ['Pick a turret target','Use the Target drop-down in the stat window, or click an enemy ship while one of yours is open.'],
    ['Watch a mine','Click it; click elsewhere to close it.'],
    ['Move the stat window','Drag its grab bar at the top.'],
    ['Other buttons','Manual (this game\'s own short rules), Music on/off, and Surrender, at the top of the screen.']], [0.27,0.73]))
story.append(CondPageBreak(150)); story.append(H2('What the colours and lines mean'))
story.append(table([['You see','It means'],
    ['Dashed red line between two ships','Your confirmed turret target.'],
    ['Red wedges around an open ship','That ship\'s firing arcs (broadsides and turret cone). Dark shading: an island blocks the view.'],
    ['Blue fan (Movement phase)','How far the open ship can reach this turn.'],
    ['Orange, then white, course line','Orange: the ship must hold its heading (MSMD). White: it may now turn.'],
    ['Gold arrow + "X Degrees of rotation off of target"','The turret could not get its cone on target; X degrees of rotation are still needed.'],
    ['Firing Arcs buttons (stat window)','Turret, Broadside and Torpedo buttons switch that ship\'s arcs on or off on the map, independently. All arcs '
     'start off, so switch on what you need. Only weapons the ship carries get a button.'],
    ['"island blocks LOS" / "ship blocks LOS" in Fire Control','Something is in the way of that target: your guns cannot fire at it from here.'],
    ['Boxy transparent blue arrow','A ship that is dead in the water, and the direction it is drifting.'],
    ['Boxy transparent orange arrow','A ship whose helm is jammed, and the direction it is stuck going. Labelled "HELM JAMMED L/R".'],
    ['"all ahead full", "full reverse", "focus target" tags','The order that ship is under this round (in the fleet list).'],
    ['Orange dashed outline','One of your torpedo lanes (lighter orange: a planned launch).'],
    ['Red dashed outline, "ENEMY TORPEDO LANE"','An enemy lane in flight. Ships still inside it when the Movement phase ends may be hit.'],
    ['Dotted gold ring around a small marker','A mine and its 10" trigger distance.'],
    ['Gold dashed ring and a gold star around a ship','A VIP in a Breakthrough battle (both sides see it). Its row in the fleet list also carries a VIP tag.'],
    ['Circles labelled ZONE A, ZONE B ...','King of the Hill capture zones, with the points each has left. Blue when you hold it, red when the enemy '
     'does, yellow when it is empty or tied.'],
    ['Green box and thick green edge line','The Exit Zone in Breakthrough, and the stretch of board edge that counts as the exit gate.'],
    ['Circles under a weapon group','Shots left this turn (filled) or spent / reloading (empty).'],
    ['Banner sweeping across the board on a navy stripe','A new phase is starting (Movement, Shooting, Special Orders), the battle is starting '
     '(Battle Commence) or it is over (Victory, Defeat).'],
    ['Gold clock in the top bar (Multiplayer)','Time left to give this phase\'s orders. It turns red in the last 30 seconds.']], [0.36,0.64], keep=False))

# ---------------- 11. Breakthrough ----------------
story.append(PageBreak())
story.append(CondPageBreak(200)); story.append(H1('11. Breakthrough'))
story.append(P("Breakthrough is the second Skirmish battle. One admiral is the <b>Attacker</b> and must get chosen ships, the <b>VIPs</b>, off the far "
    "side of the sea through an <b>Exit Zone</b>. The other is the <b>Defender</b> and must stop them. Both sides field the same fleet, and you choose "
    "which role to play. The computer plays the other side, and can play either role. (Breakthrough can also be played online: see Section 13.)"))
story.append(img(FIG+'old-bt-brief.jpg', 380))
story.append(CondPageBreak(150)); story.append(H2('Setting up'))
story += steps("<b>Build your fleet.</b> As in Annihilation, with a <b>Breakthrough Options</b> box underneath: pick <b>Attacker</b> or <b>Defender</b>, "
    "and how many VIPs the attacker has (from 1 up to the whole fleet).",
    "<b>Fitment.</b> The same as Annihilation.",
    "<b>Briefing.</b> It explains the mission. An attacking player ticks the VIPs; with more than one VIP, at least one must be a ship of the heaviest "
    "class in the fleet. Auto-pick takes the heaviest ship, then random others. A defending player is shown which enemy ships are VIPs. Both sides "
    "always know the VIPs.",
    "<b>Deployment.</b> You place every ship on the real board, as described below. There is no Formation or Heading screen.")
story.append(CondPageBreak(150)); story.append(H2('The board'))
story.append(table([['Zone','Size and place'],
    ['Attacker zone (orange)','The whole of the west or the east edge of the 800" x 800" board, chosen at random each battle, 200" deep.'],
    ['Exit Zone (green)','200" long along the opposite edge, 100" deep, at a random place along that edge.'],
    ['Defender zone (blue)','A 200" by 200" square, halfway between the attacker zone and the Exit Zone, level with the Exit Zone.']], [0.27,0.73]))
story.append(P("Islands are placed as usual, except that none touch a deployment zone or the Exit Zone, and there is always at least one clear lane "
    "across the board."))
story.append(CondPageBreak(150)); story.append(H2('Deploying your fleet'))
story += bullets("The <b>Deployment tray</b> lists your ships. <b>Drag</b> a ship from the tray onto the board. A ghost of its hull shows <b>green</b> where "
    "it may go and <b>red</b> where it may not. Drop it to place it; drag a placed ship to move it.",
    "A ship must sit <b>fully inside your own zone</b>, not on an island, and not overlapping another ship. The Exit Zone is off limits.",
    "Select a placed ship to show its <b>heading handle</b> (a gold dot just ahead of the bow). Drag it round to set the heading, or use the 15° "
    "buttons in the tray. The Firing Arcs buttons work here too, so you can check your guns' coverage.",
    "<b>Auto-place</b> places the ships still waiting; <b>Reset</b> takes everything back; the x on a row takes one ship back. The tray counts how many "
    "ships are placed, and Ready stays greyed out until all are on the board.",
    "During deployment you can see all three zones, but <b>not the enemy's ships</b>. Both fleets are placed in secret; when you press Ready the enemy "
    "deployment is revealed, the Battle Commence banner plays and Round 1 begins.")
story.append(img(FIG+'old-bt-deploy.jpg', 380))
story.append(CondPageBreak(150)); story.append(H2('Getting out: extraction'))
story += bullets("A ship <b>extracts</b> if it ends a round <b>completely inside the Exit Zone</b> (checked at the end of the Firing phase, after any All "
    "Ahead Full moves), or if it sails <b>off the board through the Exit Zone's stretch of edge</b>.",
    "A ship inside the Exit Zone is not removed until the end of the Firing phase, so the defenders can still shoot at it. A ship sunk first does not extract.",
    "Sailing off the board anywhere else still destroys the ship, as in Annihilation.",
    "Any attacking ship can extract, but <b>only the VIPs count</b> towards winning.")
story.append(img(FIG+'old-bt-mid.jpg', 230))
story.append(CondPageBreak(150)); story.append(H2('Winning and losing'))
story += bullets("The <b>attacker wins</b> if more than half of the VIPs extract (1 of 1, 2 of 2, 2 of 3, 3 of 4 ...).",
    "The <b>defender wins</b> if the VIPs are sunk or lost, or if the 20-round limit runs out without enough of them getting away.",
    "The battle ends as soon as every VIP has either extracted or been lost, or at the end of the Firing phase of Round 20. <b>If every defender is "
    "sunk, the defender loses.</b>",
    "A VIP that is dead in the water has no special rule: it can still be sunk, or drift into the zone and escape.")
story.append(CondPageBreak(150)); story.append(H2('The computer admiral'))
story += bullets("<b>As attacker</b> it runs its VIPs straight for the exit, using All Ahead Full when no enemy is close or when it is behind the "
    "schedule needed to beat the round limit. Its other ships engage defenders that threaten a VIP, and otherwise shadow the VIPs towards the exit.",
    "<b>As defender</b> its ships go for a VIP whenever they can strike it now or within the next few turns, and shoot it first whenever it is in gun "
    "range. If no VIP is within reach they attack the nearest ship, or hold a position in front of the Exit Zone if the enemy is far away.")
story.append(note('Mind the clock', "The Exit Zone is across the whole 800\" board, roughly 500\" to 700\" from a VIP's start. A Battleship's top speed is "
    "60\" a round, but it takes several rounds to build up to it, so a VIP that stops to fight or dodges around islands may still need All Ahead Full "
    "in some rounds to cross in time (the extra move replaces its shooting). The top bar tracks your VIPs (out / afloat / lost, and how many you need) "
    "and the round number out of 20."))

# ---------------- 12. King of the Hill ----------------
story.append(PageBreak())
story.append(CondPageBreak(200)); story.append(H1('12. King of the Hill'))
story.append(P("King of the Hill is the third Skirmish battle. Two equal fleets fight over a series of <b>capture zones</b>. Each zone holds a set "
    "number of points; the side that holds a zone at the end of a Firing phase takes points out of it, and when a zone runs dry it disappears and the "
    "next one appears somewhere else. The fight keeps moving instead of camping on one spot. Both sides want the same thing, so there are no roles. "
    "The computer plays the other fleet (or another player online: see Section 13)."))
story.append(img(FIG+'new-koth-brief.jpg', 330, 'The briefing, where you choose the number of zones and the points in each.'))
story.append(CondPageBreak(150)); story.append(H2('Setting up'))
story += steps("<b>Build your fleet</b> and <b>Fitment</b>. The same as Annihilation.",
    "<b>Briefing.</b> It explains the mission and has two drop-downs: <b>Number of zones</b> (1 to 5) and <b>Points per zone</b> (5, 10, 15, 20, 25 or "
    "30). It shows the total points on offer. The game starts you at 3 zones of 10 points.",
    "<b>Deployment.</b> You place every ship by hand on the real board, exactly as in Breakthrough (Section 11): drag from the tray, set headings, use "
    "Auto-place or Reset, then press Ready. Both fleets are placed in secret and revealed together.")
story.append(CondPageBreak(150)); story.append(H2('The board and the zones'))
story += bullets("The board is <b>800\" by 800\"</b>. Each fleet deploys in a band <b>150\" deep</b> along one of two opposite edges (west and east, or "
    "north and south, chosen at random).",
    "Each capture zone is a <b>circle 100\" across</b>, labelled Zone A, Zone B and so on, with the points it has left written above it.",
    "<b>Up to two zones are on the board at once</b> (one, if you chose a single zone). The first ones appear at random spots <b>near the middle of "
    "the board</b>, within 175\" of the centre, so neither fleet starts closer.",
    "When a zone runs dry it disappears and <b>the next zone appears at a random spot anywhere on the board</b>, clear of islands and, where possible, "
    "at least 250\" from both the other live zone and the zone it replaces.",
    "Islands are placed as usual, except that none touch the deployment bands or the first zones, and there is always a clear lane across the board.")
story.append(img(FIG+'new-koth-deploy.jpg', W-2*M-40, 'Deployment: your blue band, the enemy band (its ships stay hidden) and the first two zones near the middle.'))
story.append(CondPageBreak(150)); story.append(H2('Holding a zone and scoring'))
story += bullets("At the <b>end of every Firing phase</b>, after any All Ahead Full moves, each side adds up the <b>presence weight</b> of its ships in "
    "each zone. A ship is in a zone when its centre is inside the circle, and only ships still afloat count.",
    "In each zone, the side with the higher total <b>takes points equal to its winning margin</b>: a Battleship (3) against a lone Frigate (1) takes 2. "
    "A tie, or an empty zone, gives nothing. A zone cannot pay out more than it has left.",
    "Both zones are scored separately, so you can take points from both in the same round.",
    "Because scoring waits until the end of the Firing phase, ships that sail into a zone can still be shot before they count.")
story.append(table([['Class','Weight'],['Frigate','1'],['Destroyer','1'],['Light Cruiser','2'],['Medium Cruiser','2'],['Heavy Cruiser','3'],['Battleship','3']], [0.6,0.4]))
story.append(P("A ship that is <b>dead in the water</b> counts for half its weight, rounded down (so a crippled Frigate or Destroyer counts for nothing, "
    "a Light or Medium Cruiser for 1, and a Heavy Cruiser or Battleship for 1). Ramming is allowed: shoving a rival out of a circle changes who holds it."))
story.append(img(FIG+'new-koth-mid.jpg', W-2*M-40, 'Mid-battle: Zone A is yours (blue), Zone B the enemy\'s (red). The top bar shows the score and each zone\'s points left.'))
story.append(CondPageBreak(150)); story.append(H2('Winning'))
story += bullets("The battle ends when <b>every zone has been emptied</b>: the higher score wins.",
    "If the scores are tied, the side with the larger surviving fleet (by presence weight) wins, and then the side with more Structure left on its ships. "
    "(In an online game that is still level on everything, a coin toss decides, so both screens agree.)",
    "<b>Sinking the whole enemy fleet</b> wins outright, whatever the score.",
    "There is no round limit.")
story.append(CondPageBreak(150)); story.append(H2('The computer admiral'))
story += bullets("It <b>splits its fleet across the live zones</b>: each ship heads for the nearest zone, but a zone that already has fleetmates heading "
    "for it counts as further away, so the fleet spreads out. Inside a zone each ship takes its own spot so they do not crowd together.",
    "Inside or near its zone it attacks the nearest enemy that is also fighting for that zone. A ship that is badly hurt (under about a third of its "
    "Structure) falls back to the rim instead of pushing in.")
story.append(note('Reading the top bar', "During a King of the Hill battle the top bar shows both scores, each live zone with its points left and who holds "
    "it right now (yours, enemy, contested or empty), and how many zones are still to come."))

# ---------------- 13. Multiplayer ----------------
story.append(PageBreak())
story.append(CondPageBreak(200)); story.append(H1('13. Multiplayer'))
story.append(P("Multiplayer is a battle against another player over the internet. <b>Every Skirmish battle can be played online</b>: Annihilation, "
    "Breakthrough and King of the Hill. Each player sees their own fleet as \"yours\" and the other as the enemy. Both players give their orders at the "
    "same time without seeing each other's, and when both are done the orders are carried out together, with <b>the same dice results on both screens</b>. "
    "Single-player games need no internet connection; Multiplayer does."))
story.append(img(FIG+'new-mp-lobby.jpg', 290, 'The Multiplayer screen: the host\'s choices on the left, joining on the right.'))
story.append(CondPageBreak(150)); story.append(H2('Hosting and joining'))
story += steps("Both players choose <b>Multiplayer</b> on the Main Menu. The <b>server address</b> is filled in for you.",
    "One player is the <b>host</b>. Before pressing <b>Host Game</b> they choose the <b>Battle</b> (Annihilation, Breakthrough or King of the Hill), the "
    "<b>Time per phase</b> (2, 3 or 4 minutes) and, for King of the Hill, the <b>capture zones</b> and <b>points per zone</b>. They are given a "
    "<b>4-letter code</b> to send to the other player.",
    "The other player types the code under <b>Join a game</b> and presses <b>Join</b>. While they wait, they are told what the host chose.")
story.append(CondPageBreak(150)); story.append(H2('Setting up an online battle'))
story += bullets("The <b>host picks the ships</b>, and both fleets get the same ones. Each player then fits out and names their own fleet.",
    "<b>Annihilation:</b> each player arranges their Formation and chooses a heading. Choosing the same heading gives a contested crossing, as in Skirmish.",
    "<b>Breakthrough:</b> the host picks their own role (Attacker or Defender) and the number of VIPs in the Breakthrough Options box on the fleet "
    "screen; the other player takes the other role. The attacker ticks the VIPs in the briefing, and the defender sees them, marked with stars and "
    "listed in the log, when deployment begins.",
    "<b>Breakthrough and King of the Hill:</b> each player deploys by hand, in secret. The fleets are revealed when both have pressed Ready.",
    "Unnamed ships are named from the list as usual; the host's and the guest's ships draw from different halves of it, so no name appears in both fleets.")
story.append(CondPageBreak(150)); story.append(H2('Orders Completed and the phase clock'))
story.append(img(FIG+'new-mp-topbar.jpg', W-2*M, 'The top bar online: the phase clock beside the round number, and the Orders Completed button under the phase banner.'))
story += bullets("Every set of orders (deployment, Movement, Firing and Special Orders) ends with an <b>Orders Completed</b> button, which takes the place "
    "of End Movement Phase, Commence Firing and End Special Orders Phase. Skip Firing Phase is not used online: Orders Completed works even with "
    "nothing in range.",
    "Once you have pressed it, the banner reads \"waiting for your opponent's orders\". If your opponent finishes first, it says \"your opponent is "
    "ready\". When both have finished, both fleets' orders are carried out together.",
    "In Movement, Orders Completed is always available. Any ship still without movement orders <b>holds its course at minimum speed</b> (the ship you "
    "are plotting takes the course on screen). The game asks first if any ships have no orders.",
    "A <b>clock</b> in the top bar counts down the time per phase the host chose. It turns red in the last 30 seconds. <b>When it reaches zero, your "
    "orders go in as they stand</b>: unconfirmed choices are dropped, idle ships hold course at minimum speed, and in deployment any ships not yet "
    "placed are placed for you.",
    "After the Firing results there are <b>30 seconds</b> to look before the phase moves on by itself, so nobody can stall the game.")
story.append(CondPageBreak(150)); story.append(H2('Leaving and connection problems'))
story += bullets("If a player surrenders or leaves, the other wins (with the Victory banner).",
    "If the connection to the server is lost, the battle ends without a result.",
    "Both players must be running the same version of the game. If one of you has the game open from before an update, reload the page.",
    "Online play needs the multiplayer server to be running. If both players see a connection error on the Multiplayer screen, it is probably down.")

# ---------------- 14. Quick reference ----------------
story.append(PageBreak())
story.append(CondPageBreak(200)); story.append(H1('14. Quick Reference'))
story.append(CondPageBreak(150)); story.append(H2('A round, step by step'))
story.append(table([['Phase','You do','Then'],
    ['1. Movement','For each ship: pick a Turret Target and Confirm Target; drag a course; Confirm Movement. Press End Movement Phase.',
     'Enemy moves. All ships sail; turrets swing onto targets; earlier torpedoes strike; mines may trigger.'],
    ['2. Firing','For each ship that can shoot: queue volleys, Confirm Targeting (All Ahead Full ships plot an extra move). Press Commence Firing (or Skip Firing Phase).',
     'Both sides fire at once. Press End Firing Phase: All Ahead Full moves are made, then sinkings and critical hits; King of the Hill zones are scored.'],
    ['3. Special Orders','For each ship: ONE order (Torpedo / Mine / Course / All Ahead Full / Full Reverse Stop / Focus Target), then confirm. Press End Special Orders Phase.',
     'Torpedoes launch, mines drop. Next round: shields +5 per facing, guns refill, repairs rolled.']], [0.17,0.43,0.40]))
story.append(P("Online, each of those end-of-phase buttons is Orders Completed, and the phase clock is running (Section 13).", small))
story.append(CondPageBreak(150)); story.append(H2('Key numbers'))
story.append(table([['Item','Value'],
    ['Board','Annihilation 1,200" x 800"; Breakthrough and King of the Hill 800" x 800"; 1 to 5 islands (at most 5% of the area)'],
    ['Top speed cap','Base movement x multiplier: Frigate 90", Destroyer 75", Light Cruiser 62.5", Medium / Heavy Cruiser 62.5", Battleship 60"'],
    ['Minimum move / MSMD','50% of last move / 45% of last move (first move: class minimum turn distance)'],
    ['Broadside arc / turret cone','90° each side / 25° wide, traversing 90° (Frigate) or 60° (others) per turn'],
    ['Turret fire fore or aft','Costs 2 shots per mount per volley (half rate)'],
    ['Gunnery','Battleship 10; cruisers 12; Destroyer and Frigate 13. Roll d20 + modifiers; must beat Gunnery'],
    ['Line of sight','Islands and other ships (friend or foe) block gunfire; a blocked gun keeps its shots'],
    ['Torpedo lane','7° cone to 15" wide (about 123" out), then a 15"-wide strip to 600"'],
    ['Torpedo hit chance','95% point-blank, 10% at 600"; hits the nearest ship in the lane, friend or foe; 15 damage'],
    ['Torpedo reload','Each fired shot spends one round reloading; unfired shots stay ready'],
    ['Mine','Frigates only. Triggers within 10" of an enemy ending a move; 20 damage, ignores shields; Gunnery 4; used up either way'],
    ['Course Adjustment','In place, up to half the turning stat (Frigate 30°, Battleship 20°, others 22.5°)'],
    ['All Ahead Full','Next round: no shooting; extra move made after all shots are rolled'],
    ['Full Reverse Stop','Next round: coasts 25% of last move, no turns; gun shots against it +3 to hit'],
    ['Focus Target','Next round: turret range doubled at one chosen enemy only; no turning, no retargeting, repeats last move\'s distance'],
    ['Breakthrough zones','Attacker band 200" deep on the west or east edge; Exit Zone 200" x 100" on the opposite edge; Defender square 200" x 200" halfway between'],
    ['Breakthrough win','Attacker: more than 50% of VIPs extracted. Defender: otherwise (round limit 20), or if every defender is sunk the defender loses'],
    ['King of the Hill zones','1 to 5 zones of 5 to 30 points; circles 100" across; up to two at once; first ones within 175" of the centre; bands 150" deep on two opposite edges'],
    ['King of the Hill scoring','End of each Firing phase, per zone: the side with more presence weight takes its winning margin (Frigate 1, Destroyer 1, Light 2, '
     'Medium 2, Heavy 3, Battleship 3; dead in the water half, rounded down). Ends when every zone is empty'],
    ['Extraction','Ending the Firing phase fully inside the Exit Zone, or sailing off through its edge; any attacker may, only VIPs count'],
    ['Collision / ram','Hulls overlapping in the sweep. Impact = distance/5 (head-on adds both, sideswipe half); split by the other ship\'s size '
     '(1 / 1.5 / 2 / 3 / 4 / 6); ignores shields; both ships stop'],
    ['Grounding','One third of max Structure (bypasses defenses); frozen next turn; re-float within 30" the turn after; +5 to hit and no shield while aground'],
    ['Critical hit','On a Structure hit roll D20 (needs 16 / 11 / 6 / any as armor falls below 75 / 50 / 25%). D6: 1 explodes, 2–5 dead in water, '
     '6 helm jammed (D2 left/right). Repair roll D2 each phase after the first; lowest D6 counts'],
    ['Shield regeneration','+5 per facing (not stern) at the start of your Movement phase; armor and Structure never regenerate'],
    ['Multiplayer','Host picks battle, ships and 2 / 3 / 4 minutes per phase; Orders Completed; at zero orders go in as they stand; 30 s to view Firing results']],
    [0.24,0.76], keep=False))
story.append(CondPageBreak(150)); story.append(H2('Glossary'))
story.append(table([['Term','Meaning'],
    ['Attacker / Defender','The two roles in Breakthrough: the side that must get its VIPs out, and the side that must stop them.'],
    ['Aground / grounded','Stuck on an island after running into it.'],
    ['Broadside','Guns fixed to the port or starboard side of the hull, firing into a 90° arc.'],
    ['Capture zone','A circle 100" across in King of the Hill, holding a set number of points. Holding it at the end of a Firing phase takes points out of it.'],
    ['Critical Damage','A crippling result rolled when a hit reaches Structure: explosion, dead in the water or steering jammed.'],
    ['Dead in the water','A crippled ship with no power: no movement orders, no turret, no Special Orders; coasts straight at 50% of its last move. Broadsides still fire.'],
    ['Exit Zone','The green zone on the far edge of the board in Breakthrough. Ending a round fully inside it, or sailing off the board through its edge, extracts a ship.'],
    ['Extraction','Leaving the battle safely through the Exit Zone. Happens at the end of the Firing phase, or at once when sailing off through the exit gate.'],
    ['Facing','One of a ship\'s four 90° sides: prow, starboard, stern, port. Shields and armor are tracked per facing.'],
    ['Fleet list','The stacked list of your ships in the stat window; one ship is open at a time.'],
    ['Focus Target','A Special Order: next round the ship\'s turrets reach twice as far at one chosen enemy, but it holds course and speed.'],
    ['Gunnery','The number a d20 roll (plus modifiers) must beat to hit. Lower is better.'],
    ['Heading','The compass direction a ship points: 0° north, 90° east, 180° south, 270° west.'],
    ['Helm jammed','A crippled ship stuck in a full-lock turn to one side.'],
    ['Host / guest','In Multiplayer, the player who creates the game (and chooses the battle, time and ships) and the player who joins with the code.'],
    ['Line of sight','A clear straight line from shooter to target, with no island and no other ship in the way.'],
    ['Momentum','The rules tying each move\'s minimum and maximum distance to the last move.'],
    ['MSMD','Minimum Ship Movement Distance: how far a ship must hold its heading before it may turn.'],
    ['Orders Completed','In Multiplayer, the button that says you have finished this phase\'s orders.'],
    ['Phase clock','In Multiplayer, the countdown for each phase\'s orders; at zero the orders go in as they stand.'],
    ['Presence weight','What a ship counts for when holding a capture zone: Frigate 1, Destroyer 1, Light Cruiser 2, Medium Cruiser 2, Heavy Cruiser 3, '
     'Battleship 3 (half, rounded down, if dead in the water).'],
    ['Prow / stern','The front and the back of a ship.'],
    ['Port / starboard','The left and the right of a ship, looking forward.'],
    ['Ram','A collision where one ship\'s bow strikes another ship\'s side or stern.'],
    ['Traverse','Rotating a turret. Limited per turn by the ship\'s Turret Traverse.'],
    ['VIP','A ship marked with a gold star that the attacker must get out in Breakthrough.'],
    ['Volley','One shot from each fitted gun in a group that still has shots left.']], [0.22,0.78], keep=False))

story += [NextPageTemplate('back'), PageBreak(), Spacer(1,1)]

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
doc = Doc(OUT)
doc.multiBuild(story)
print('wrote', OUT)
